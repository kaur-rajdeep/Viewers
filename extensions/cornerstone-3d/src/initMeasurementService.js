import { eventTarget, EVENTS } from '@cornerstonejs/core';
import { Enums, annotation } from '@cornerstonejs/tools';
import { DicomMetadataStore } from '@ohif/core';

import measurementServiceMappingsFactory from './utils/measurementServiceMappings/measurementServiceMappingsFactory';

const { removeAnnotation } = annotation.state;

const csToolsEvents = Enums.Events;

const CORNERSTONE_TOOLS_3D_SOURCE_NAME = 'CornerstoneTools3D';

const initMeasurementService = (
  MeasurementService,
  DisplaySetService,
  Cornerstone3DViewportService
) => {
  /* Initialization */
  const {
    Length,
    Bidirectional,
    EllipticalROI,
    RectangleROI,
  } = measurementServiceMappingsFactory(
    MeasurementService,
    DisplaySetService,
    Cornerstone3DViewportService
  );
  const csTools3DVer1MeasurementSource = MeasurementService.createSource(
    CORNERSTONE_TOOLS_3D_SOURCE_NAME,
    '1'
  );

  /* Mappings */
  MeasurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'Length',
    Length.matchingCriteria,
    Length.toAnnotation,
    Length.toMeasurement
  );

  MeasurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'Bidirectional',
    Bidirectional.matchingCriteria,
    Bidirectional.toAnnotation,
    Bidirectional.toMeasurement
  );

  MeasurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'EllipticalROI',
    EllipticalROI.matchingCriteria,
    EllipticalROI.toAnnotation,
    EllipticalROI.toMeasurement
  );

  MeasurementService.addMapping(
    csTools3DVer1MeasurementSource,
    'RectangleROI',
    RectangleROI.matchingCriteria,
    RectangleROI.toAnnotation,
    RectangleROI.toMeasurement
  );

  return csTools3DVer1MeasurementSource;
};

const connectToolsToMeasurementService = (
  MeasurementService,
  DisplaySetService,
  Cornerstone3DViewportService
) => {
  const csTools3DVer1MeasurementSource = initMeasurementService(
    MeasurementService,
    DisplaySetService,
    Cornerstone3DViewportService
  );
  connectMeasurementServiceToTools(
    MeasurementService,
    Cornerstone3DViewportService,
    csTools3DVer1MeasurementSource
  );
  const { annotationToMeasurement, remove } = csTools3DVer1MeasurementSource;
  const elementEnabledEvt = EVENTS.ELEMENT_ENABLED;

  /* Measurement Service Events */
  eventTarget.addEventListener(elementEnabledEvt, evt => {
    function addMeasurement(csToolsEvent) {
      try {
        const annotationAddedEventDetail = csToolsEvent.detail;
        const {
          annotation: { metadata, annotationUID },
        } = annotationAddedEventDetail;
        const { toolName } = metadata;

        // To force the measurementUID be the same as the annotationUID
        // Todo: this should be changed when a measurement can include multiple annotations
        // in the future
        annotationAddedEventDetail.uid = annotationUID;
        annotationToMeasurement(toolName, annotationAddedEventDetail);
      } catch (error) {
        console.warn('Failed to update measurement:', error);
      }
    }
    function updateMeasurement(csToolsEvent) {
      try {
        const annotationModifiedEventDetail = csToolsEvent.detail;

        const {
          annotation: { metadata, annotationUID },
        } = annotationModifiedEventDetail;

        // If the measurement hasn't been added, don't modify it
        const measurement = MeasurementService.getMeasurement(annotationUID);

        if (!measurement) {
          return;
        }
        const { toolName } = metadata;

        annotationModifiedEventDetail.uid = annotationUID;
        annotationToMeasurement(toolName, annotationModifiedEventDetail);
      } catch (error) {
        console.warn('Failed to update measurement:', error);
      }
    }

    /**
     * When csTools fires a removed event, remove the same measurement
     * from the measurement service
     *
     * @param {*} csToolsEvent
     */
    function removeMeasurement(csToolsEvent) {
      try {
        try {
          const annotationRemovedEventDetail = csToolsEvent.detail;
          const {
            annotation: { annotationUID },
          } = annotationRemovedEventDetail;

          const measurement = MeasurementService.getMeasurement(annotationUID);

          if (measurement) {
            console.log('~~ removeEvt', csToolsEvent);
            remove(annotationUID, annotationRemovedEventDetail);
          }
        } catch (error) {
          console.warn('Failed to update measurement:', error);
        }
      } catch (error) {
        console.warn('Failed to remove measurement:', error);
      }
    }

    // on display sets added, check if there are any measurements in measurement service that need to be
    // put into cornerstone tools
    const completedEvt = csToolsEvents.ANNOTATION_COMPLETED;
    const updatedEvt = csToolsEvents.ANNOTATION_MODIFIED;
    const removedEvt = csToolsEvents.ANNOTATION_REMOVED;

    eventTarget.addEventListener(completedEvt, addMeasurement);
    eventTarget.addEventListener(updatedEvt, updateMeasurement);
    eventTarget.addEventListener(removedEvt, removeMeasurement);
  });

  return csTools3DVer1MeasurementSource;
};

const connectMeasurementServiceToTools = (
  MeasurementService,
  Cornerstone3DViewportService,
  measurementSource
) => {
  const {
    MEASUREMENT_REMOVED,
    MEASUREMENTS_CLEARED,
    MEASUREMENT_UPDATED,
    RAW_MEASUREMENT_ADDED,
  } = MeasurementService.EVENTS;

  const csTools3DVer1MeasurementSource = MeasurementService.getSource(
    CORNERSTONE_TOOLS_3D_SOURCE_NAME,
    '1'
  );

  const { measurementToAnnotation } = csTools3DVer1MeasurementSource;

  MeasurementService.subscribe(MEASUREMENTS_CLEARED, ({ measurements }) => {
    if (!Object.keys(measurements).length) {
      return;
    }

    for (const measurement of Object.values(measurements)) {
      const { uid, source } = measurement;
      if (source.name !== CORNERSTONE_TOOLS_3D_SOURCE_NAME) {
        continue;
      }

      removeAnnotation(uid);
    }
  });

  MeasurementService.subscribe(
    MEASUREMENT_UPDATED,
    ({ source, measurement, notYetUpdatedAtSource }) => {
      if (source.name !== CORNERSTONE_TOOLS_3D_SOURCE_NAME) {
        return;
      }

      if (notYetUpdatedAtSource === false) {
        // This event was fired by cornerstone telling the measurement service to sync.
        // Already in sync.
        return;
      }

      const annotationType = measurement.metadata.toolName;
      measurementToAnnotation(annotationType, measurement);
    }
  );

  MeasurementService.subscribe(
    RAW_MEASUREMENT_ADDED,
    ({ source, measurement, data: toolData, dataSource }) => {
      if (source.name !== CORNERSTONE_TOOLS_3D_SOURCE_NAME) {
        return;
      }

      const {
        referenceSeriesUID,
        referenceStudyUID,
        SOPInstanceUID,
      } = measurement;

      const instance = DicomMetadataStore.getInstance(
        referenceStudyUID,
        referenceSeriesUID,
        SOPInstanceUID
      );

      const imageId = dataSource.getImageIdsForInstance({ instance });
      const annotationManager = annotation.state.getDefaultAnnotationManager();
      annotationManager.addAnnotation({
        annotationUID: measurement.uid,
        highlighted: false,
        isLocked: false,
        invalidated: false,
        metadata: {
          toolName: measurement.toolName,
          FrameOfReferenceUID: measurement.FrameOfReferenceUID,
          referencedImageId: imageId,
        },
        data: {
          handles: { ...toolData.data.handles },
          cachedStats: { ...toolData.data.cachedStats },
        },
      });
    }
  );

  MeasurementService.subscribe(
    MEASUREMENT_REMOVED,
    ({ source, measurement: removedMeasurementId }) => {
      if (source.name !== CORNERSTONE_TOOLS_3D_SOURCE_NAME) {
        return;
      }
      removeAnnotation(removedMeasurementId);
      const renderingEngine = Cornerstone3DViewportService.getRenderingEngine();
      // Note: We could do a better job by triggering the render on the
      // viewport itself, but the removeAnnotation does not include that info...
      renderingEngine.render();
    }
  );
};

export {
  initMeasurementService,
  connectToolsToMeasurementService,
  connectMeasurementServiceToTools,
};