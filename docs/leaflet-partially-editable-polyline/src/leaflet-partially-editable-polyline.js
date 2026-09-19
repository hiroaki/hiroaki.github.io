import { LatLng, Marker, Polyline, DivIcon } from "leaflet";

/**
 * Error raised when an application tries to start editing while editing is
 * disabled.
 */
export class EditingDisabledError extends Error {
  constructor() {
    super("Editing is disabled.");
    this.name = "EditingDisabledError";
  }
}

/**
 * A small Leaflet v2 polyline editor.
 *
 * Editing is deliberately limited to the two-dimensional LatLng geometry.
 * The consumer remains responsible for application data such as elevation,
 * timestamps, GPX structure, and persistence.
 *
 * A click on the polyline starts editing around the nearest point. Only a
 * bounded neighborhood is represented by Leaflet markers, which keeps large
 * polylines responsive. During a drag, only short helper lines are updated;
 * the complete polyline is committed when the drag ends.
 */
export class PartiallyEditablePolyline extends Polyline {
  static defaultPointIcon = new DivIcon({
    className: "leaflet-partially-editable-polyline-point",
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });

  static defaultNewPointIcon = new DivIcon({
    className: "leaflet-partially-editable-polyline-new-point",
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  });

  static defaultOptions = {
    editablePointRadius: 100,
    pointIcon: PartiallyEditablePolyline.defaultPointIcon,
    newPointIcon: PartiallyEditablePolyline.defaultNewPointIcon,
  };

  constructor(latlngs, options = {}) {
    super(latlngs, {
      ...options,
      bubblingPointerEvents: false,
    });

    this._editorOptions = {
      ...PartiallyEditablePolyline.defaultOptions,
      ...options,
    };

    this._editingEnabled = true;
    this._editing = false;
    this._busy = false;
    this._pointRecords = [];
    this._editableStart = -1;
    this._editableEnd = -1;
    this._pointMarkers = [];
    this._newPointMarkers = [];
    this._dragHelpers = [];
  }

  /**
   * Replace this Polyline's geometry and synchronize the editor state.
   *
   * External geometry replacement invalidates all existing marker indices, so
   * an active editing session is ended before the new points are recorded.
   */
  setLatLngs(latlngs) {
    // Polyline's constructor may call this override before this subclass has
    // initialized its editor state.
    const hasEditorState = Array.isArray(this._pointRecords);

    if (hasEditorState && this._editing) {
      this.endEditing();
    }

    super.setLatLngs(latlngs);

    if (hasEditorState) {
      this._replacePointRecords(this.getLatLngs());
    }

    return this;
  }

  onAdd(map) {
    super.onAdd(map);

    this._map = map;
    this._initializePointRecords();
    this._installHandlers();
  }

  onRemove(map) {
    this.endEditing();
    this._removeHandlers();
    this._clearPointMarkers();
    this._map = null;

    super.onRemove(map);
  }

  /**
   * Allow editing operations again. This does not start an editing session.
   */
  enableEditing() {
    this._editingEnabled = true;
    return this;
  }

  /**
   * Prevent all editing operations. If an editing session is active it is
   * ended immediately.
   */
  disableEditing() {
    if (this._editing) {
      this.endEditing();
    }

    this._editingEnabled = false;
    return this;
  }

  /**
   * Start an editing session around the point nearest to `latlng`.
   */
  startEditing(latlng) {
    this._assertEditingEnabled();

    if (!(latlng instanceof LatLng)) {
      throw new TypeError("startEditing() requires a Leaflet LatLng.");
    }

    if (!this._map || this._pointRecords.length === 0) {
      return this;
    }

    const index = this._findNearestPointIndex(latlng);

    if (index < 0) {
      return this;
    }

    this.endEditing();

    this._editing = true;
    this._editableStart = Math.max(
      0,
      index - this._editorOptions.editablePointRadius,
    );
    this._editableEnd = Math.min(
      this._pointRecords.length - 1,
      index + this._editorOptions.editablePointRadius,
    );

    this.fire("editingstart", {
      index,
    });

    this._rebuildEditableMarkers();
    return this;
  }

  /**
   * End the current editing session and remove all editing markers.
   */
  endEditing() {
    if (!this._editing) {
      return this;
    }

    this._editing = false;
    this._busy = false;
    this._removeDragHelpers();
    this._clearPointMarkers();
    this._editableStart = -1;
    this._editableEnd = -1;

    this.fire("editingend");

    return this;
  }

  _assertEditingEnabled() {
    if (this._editingEnabled) {
      return;
    }

    const error = new EditingDisabledError();
    this.fire("editingerror", { error });
    throw error;
  }

  _initializePointRecords() {
    this._replacePointRecords(this.getLatLngs());
  }

  _replacePointRecords(latlngs) {
    this._pointRecords = latlngs.map((latlng) => ({
      latlng: this._toLatLng(latlng),
      marker: null,
      newPointMarker: null,
    }));
  }

  _installHandlers() {
    this._onPolylineClick = (event) => {
      this.startEditing(event.latlng);
    };

    this.on("click", this._onPolylineClick, this);
  }

  _removeHandlers() {
    if (this._onPolylineClick) {
      this.off("click", this._onPolylineClick, this);
      this._onPolylineClick = null;
    }
  }

  _findNearestPointIndex(latlng) {
    const target = this._toLatLng(latlng);
    let nearestIndex = -1;
    let nearestDistance = Infinity;

    for (let i = 0; i < this._pointRecords.length; i += 1) {
      const distance = target.distanceTo(this._pointRecords[i].latlng);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = i;
      }
    }

    return nearestIndex;
  }

  _rebuildEditableMarkers() {
    this._clearPointMarkers();

    if (!this._editing || !this._map) {
      return;
    }

    for (let i = this._editableStart; i <= this._editableEnd; i += 1) {
      this._createPointMarker(i);
    }
  }
  _createPointMarker(index) {
    const record = this._pointRecords[index];
    const options = {
      draggable: true,
      bubblingPointerEvents: false,
    };

    if (this._editorOptions.pointIcon) {
      options.icon = this._editorOptions.pointIcon;
    }

    const marker = new Marker(record.latlng, options);

    record.marker = marker;
    marker._editablePointIndex = index;
    marker.on("dragstart", this._handlePointDragStart, this);
    marker.on("drag", this._handlePointDrag, this);
    marker.on("dragend", this._handlePointDragEnd, this);
    marker.on("contextmenu", this._handlePointDelete, this);

    marker.addTo(this._map);
    this._pointMarkers.push(marker);

    if (index > this._editableStart) {
      this._createNewPointMarker(index - 1, index);
    }
  }

  _createNewPointMarker(previousIndex, nextIndex) {
    const previous = this._pointRecords[previousIndex];
    const next = this._pointRecords[nextIndex];

    const options = {
      draggable: true,
      bubblingPointerEvents: false,
    };

    if (this._editorOptions.newPointIcon) {
      options.icon = this._editorOptions.newPointIcon;
    }

    const marker = new Marker(this._midpoint(previous.latlng, next.latlng), options);

    marker._editablePreviousIndex = previousIndex;
    marker._editableNextIndex = nextIndex;
    marker.on("dragstart", this._handleNewPointDragStart, this);
    marker.on("drag", this._handleNewPointDrag, this);
    marker.on("dragend", this._handleNewPointDragEnd, this);
    marker.on("contextmenu", this._handleNewPointDelete, this);

    marker.addTo(this._map);
    this._newPointMarkers.push(marker);

    previous.newPointMarker = marker;
  }

  _clearPointMarkers() {
    if (!this._map) {
      this._pointMarkers = [];
      this._newPointMarkers = [];
      return;
    }

    for (const marker of this._pointMarkers) {
      marker.off();
      this._map.removeLayer(marker);
    }

    for (const marker of this._newPointMarkers) {
      marker.off();
      this._map.removeLayer(marker);
    }

    for (const record of this._pointRecords) {
      record.marker = null;
      record.newPointMarker = null;
    }

    this._pointMarkers = [];
    this._newPointMarkers = [];
  }

  _handlePointDragStart(event) {
    if (!this._editingEnabled || !this._editing) {
      return;
    }

    const marker = event.target;
    const index = marker._editablePointIndex;
    if (index == null) {
      return;
    }

    this._busy = true;

    const previous = index > 0 ? this._pointRecords[index - 1].latlng : null;
    const next =
      index < this._pointRecords.length - 1
        ? this._pointRecords[index + 1].latlng
        : null;

    this._setupDragHelpers(marker, previous, next);
    this._hideEditableMarkersExcept(marker);
  }

  _handlePointDrag(event) {
    if (!this._editingEnabled || !this._editing) {
      return;
    }

    this._updateDragHelpers(event.target.getLatLng());
  }

  _handlePointDragEnd(event) {
    if (!this._editingEnabled || !this._editing) {
      this._busy = false;
      this._removeDragHelpers();
      return;
    }

    const marker = event.target;
    const index = marker._editablePointIndex;
    if (index == null || !this._pointRecords[index]) {
      this._busy = false;
      this._removeDragHelpers();
      return;
    }

    const previousLatLng = this._pointRecords[index].latlng;
    const latlng = this._toLatLng(marker.getLatLng());

    this._pointRecords[index].latlng = latlng;
    this._commitGeometry();
    this._busy = false;
    this._removeDragHelpers();
    this._rebuildEditableMarkers();

    this.fire("pointchange", {
      index,
      latlng: this._cloneLatLng(latlng),
      previousLatLng: this._cloneLatLng(previousLatLng),
    });
  }

  _handlePointDelete(event) {
    if (!this._editingEnabled || !this._editing || this._busy) {
      return;
    }

    const index = event.target._editablePointIndex;
    if (index == null || !this._pointRecords[index]) {
      return;
    }

    const deletedLatLng = this._pointRecords[index].latlng;
    this._pointRecords.splice(index, 1);

    this._commitGeometry();

    this.fire("pointdelete", {
      index,
      latlng: this._cloneLatLng(deletedLatLng),
    });

    if (this._pointRecords.length === 0) {
      this.endEditing();
      return;
    }

    const replacementIndex = Math.min(index, this._pointRecords.length - 1);
    this._editableStart = Math.max(
      0,
      replacementIndex - this._editorOptions.editablePointRadius,
    );
    this._editableEnd = Math.min(
      this._pointRecords.length - 1,
      replacementIndex + this._editorOptions.editablePointRadius,
    );
    this._rebuildEditableMarkers();
  }

  _handleNewPointDragStart(event) {
    if (!this._editingEnabled || !this._editing) {
      return;
    }

    const marker = event.target;
    const previousIndex = marker._editablePreviousIndex;
    const nextIndex = marker._editableNextIndex;

    if (
      previousIndex == null ||
      nextIndex == null ||
      !this._pointRecords[previousIndex] ||
      !this._pointRecords[nextIndex]
    ) {
      return;
    }

    this._busy = true;
    this._setupDragHelpers(
      marker,
      this._pointRecords[previousIndex].latlng,
      this._pointRecords[nextIndex].latlng,
    );
    this._hideEditableMarkersExcept(marker);
  }

  _handleNewPointDrag(event) {
    if (!this._editingEnabled || !this._editing) {
      return;
    }

    this._updateDragHelpers(event.target.getLatLng());
  }

  _handleNewPointDragEnd(event) {
    if (!this._editingEnabled || !this._editing) {
      this._busy = false;
      this._removeDragHelpers();
      return;
    }

    const marker = event.target;
    const previousIndex = marker._editablePreviousIndex;
    const nextIndex = marker._editableNextIndex;

    if (
      previousIndex == null ||
      nextIndex == null ||
      !this._pointRecords[previousIndex] ||
      !this._pointRecords[nextIndex]
    ) {
      this._busy = false;
      this._removeDragHelpers();
      return;
    }

    const latlng = this._toLatLng(marker.getLatLng());
    const index = nextIndex;

    this._pointRecords.splice(index, 0, {
      latlng,
      marker: null,
      newPointMarker: null,
    });

    this._commitGeometry();
    this._busy = false;
    this._removeDragHelpers();

    this.fire("pointinsert", {
      index,
      latlng: this._cloneLatLng(latlng),
    });

    this._editableStart = Math.max(
      0,
      index - this._editorOptions.editablePointRadius,
    );
    this._editableEnd = Math.min(
      this._pointRecords.length - 1,
      index + this._editorOptions.editablePointRadius,
    );
    this._rebuildEditableMarkers();
  }

  _handleNewPointDelete() {
    // Midpoint markers are insertion handles, not data points. There is no
    // meaningful delete operation for one; keep the context menu inert.
  }

  _hideEditableMarkersExcept(except) {
    for (const marker of this._pointMarkers) {
      if (marker !== except) {
        this._map.removeLayer(marker);
      }
    }

    for (const marker of this._newPointMarkers) {
      if (marker !== except) {
        this._map.removeLayer(marker);
      }
    }
  }

  _setupDragHelpers(marker, point1, point2) {
    this._removeDragHelpers();

    if (point1) {
      this._dragHelpers.push(
        new Polyline([marker.getLatLng(), point1], {
          dashArray: "5,1",
          weight: 1,
          interactive: false,
        }).addTo(this._map),
      );
    }

    if (point2) {
      this._dragHelpers.push(
        new Polyline([marker.getLatLng(), point2], {
          dashArray: "5,1",
          weight: 1,
          interactive: false,
        }).addTo(this._map),
      );
    }
  }

  _updateDragHelpers(latlng) {
    for (const helper of this._dragHelpers) {
      const points = helper.getLatLngs();
      helper.setLatLngs([latlng, points[1]]);
    }
  }

  _removeDragHelpers() {
    if (this._map) {
      for (const helper of this._dragHelpers) {
        this._map.removeLayer(helper);
      }
    }

    this._dragHelpers = [];
  }

  _commitGeometry() {
    // Do not use this.setLatLngs(): it is the public synchronization API and
    // would end the active session and rebuild point records.
    super.setLatLngs(this._pointRecords.map((record) => record.latlng));
  }

  _midpoint(a, b) {
    return new LatLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
  }

  _toLatLng(value) {
    return this._cloneLatLng(value);
  }

  _cloneLatLng(latlng) {
    return new LatLng(latlng.lat, latlng.lng, latlng.alt);
  }
}
