(function() {
  'use strict';

  var TYPE_STYLES = {
    waypoint: { label: 'Waypoints', color: '#d97706' },
    route: { label: 'Routes', color: '#0f766e' },
    track: { label: 'Tracks', color: '#2563eb' },
    photo: { label: 'Photos', color: '#c026d3' }
  };
  var PHOTO_TIME_MATCH_LIMIT_MS = 1000 * 60 * 60 * 12;
  var JST_OFFSET_MINUTES = 9 * 60;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return '時刻なし';
    }
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date);
  }

  function summarizeCounts(summary) {
    return [
      summary.waypoint ? summary.waypoint + ' wpt' : null,
      summary.route ? summary.route + ' rte' : null,
      summary.track ? summary.track + ' trk' : null,
      summary.photo ? summary.photo + ' photo' : null
    ].filter(Boolean).join(' / ');
  }

  function createColorMarker(color) {
    return L.divIcon({
      className: 'custom-div-icon',
      html: '<span style="display:block;width:16px;height:16px;border-radius:999px;border:3px solid white;box-shadow:0 4px 12px rgba(0,0,0,0.25);background:' + color + ';"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      popupAnchor: [0, -10]
    });
  }

  function parseIsoDate(value) {
    if (!value) {
      return null;
    }
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function parseExifDateText(value) {
    if (!value) {
      return null;
    }
    var matched = String(value).trim().match(
      /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/
    );
    if (!matched) {
      return null;
    }
    return {
      year: Number(matched[1]),
      month: Number(matched[2]),
      day: Number(matched[3]),
      hour: Number(matched[4]),
      minute: Number(matched[5]),
      second: Number(matched[6])
    };
  }

  function buildDateFromParts(parts, offsetMinutes) {
    if (!parts) {
      return null;
    }
    return new Date(
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute - offsetMinutes,
        parts.second
      )
    );
  }

  function readTextFile(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  function readArrayBuffer(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function parseWaypoint(node) {
    var waypoint = {
      lat: Number(node.getAttribute('lat')),
      lon: Number(node.getAttribute('lon')),
      name: '',
      desc: '',
      ele: null,
      time: null
    };
    Array.prototype.forEach.call(node.children, function(child) {
      var text = child.textContent ? child.textContent.trim() : '';
      if (child.tagName === 'name') {
        waypoint.name = text;
      } else if (child.tagName === 'desc') {
        waypoint.desc = text;
      } else if (child.tagName === 'ele') {
        waypoint.ele = text === '' ? null : Number(text);
      } else if (child.tagName === 'time') {
        waypoint.time = parseIsoDate(text);
      }
    });
    return waypoint;
  }

  function parseGpx(text) {
    var xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.querySelector('parsererror')) {
      throw new Error('GPX を解析できませんでした。');
    }

    var metadataName = '';
    var metadataNameNode = xml.querySelector('metadata > name');
    if (metadataNameNode) {
      metadataName = metadataNameNode.textContent.trim();
    }

    var waypoints = Array.prototype.map.call(xml.getElementsByTagName('wpt'), parseWaypoint);
    var routes = Array.prototype.map.call(xml.getElementsByTagName('rte'), function(rteNode, index) {
      var nameNode = rteNode.querySelector('name');
      return {
        name: nameNode ? nameNode.textContent.trim() : 'Route ' + (index + 1),
        points: Array.prototype.map.call(rteNode.getElementsByTagName('rtept'), parseWaypoint)
      };
    }).filter(function(route) { return route.points.length > 0; });

    var tracks = Array.prototype.map.call(xml.getElementsByTagName('trk'), function(trkNode, trackIndex) {
      var trkName = trkNode.querySelector('name');
      var segments = Array.prototype.map.call(trkNode.getElementsByTagName('trkseg'), function(segNode) {
        return Array.prototype.map.call(segNode.getElementsByTagName('trkpt'), parseWaypoint);
      }).filter(function(segment) {
        return segment.length > 0;
      });
      return {
        name: trkName ? trkName.textContent.trim() : 'Track ' + (trackIndex + 1),
        segments: segments
      };
    }).filter(function(track) { return track.segments.length > 0; });

    return {
      name: metadataName,
      waypoints: waypoints,
      routes: routes,
      tracks: tracks
    };
  }

  function buildWaypointPopup(waypoint, title) {
    return [
      '<div>',
      '<strong>', escapeHtml(title || waypoint.name || 'Waypoint'), '</strong>',
      '<br/>緯度: ', escapeHtml(waypoint.lat),
      '<br/>経度: ', escapeHtml(waypoint.lon),
      waypoint.ele == null ? '' : '<br/>標高: ' + escapeHtml(Math.round(waypoint.ele)) + ' m',
      waypoint.time ? '<br/>時刻: ' + escapeHtml(formatDate(waypoint.time)) : '',
      waypoint.desc ? '<br/>' + escapeHtml(waypoint.desc) : '',
      '</div>'
    ].join('');
  }

  function ViewerApp() {
    this.map = null;
    this.entries = [];
    this.trackTimeline = [];
    this.dragDepth = 0;
    this.filterState = {
      waypoint: true,
      route: true,
      track: true,
      photo: true
    };
    this.dom = {
      fileInput: document.getElementById('file-input'),
      fitAllButton: document.getElementById('fit-all'),
      clearAllButton: document.getElementById('clear-all'),
      urlInput: document.getElementById('url-input'),
      loadUrlButton: document.getElementById('load-url'),
      dropOverlay: document.getElementById('drop-overlay'),
      layerList: document.getElementById('layer-list'),
      statusText: document.getElementById('status-text'),
      typeFilters: document.getElementById('type-filters')
    };
  }

  ViewerApp.prototype.start = function() {
    this.map = L.map('map', {
      zoomControl: true,
      preferCanvas: true
    }).setView([35.6841306, 139.774103], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(this.map);

    this.bindUi();
    this.renderTypeFilters();
    this.consumeQueryUrls();
  };

  ViewerApp.prototype.bindUi = function() {
    var self = this;

    this.dom.fileInput.addEventListener('change', function(event) {
      self.importFiles(event.target.files);
      event.target.value = '';
    });

    this.dom.fitAllButton.addEventListener('click', function() {
      self.fitAll();
    });

    this.dom.clearAllButton.addEventListener('click', function() {
      self.clearAll();
    });

    this.dom.loadUrlButton.addEventListener('click', function() {
      self.importUrlFromInput();
    });

    this.dom.urlInput.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        self.importUrlFromInput();
      }
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(type) {
      window.addEventListener(type, function(event) {
        event.preventDefault();
      });
    });

    window.addEventListener('dragenter', function() {
      self.dragDepth += 1;
      self.setDropOverlay(true);
    });

    window.addEventListener('dragleave', function() {
      self.dragDepth = Math.max(0, self.dragDepth - 1);
      if (self.dragDepth === 0) {
        self.setDropOverlay(false);
      }
    });

    window.addEventListener('drop', function(event) {
      self.dragDepth = 0;
      self.setDropOverlay(false);
      if (event.dataTransfer && event.dataTransfer.files) {
        self.importFiles(event.dataTransfer.files);
      }
    });
  };

  ViewerApp.prototype.setDropOverlay = function(active) {
    this.dom.dropOverlay.classList.toggle('is-active', active);
  };

  ViewerApp.prototype.renderTypeFilters = function() {
    var self = this;
    this.dom.typeFilters.innerHTML = '';
    Object.keys(TYPE_STYLES).forEach(function(type) {
      var chip = document.createElement('label');
      chip.className = 'type-chip';

      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = self.filterState[type];
      checkbox.addEventListener('change', function() {
        self.filterState[type] = checkbox.checked;
        self.applyTypeFilters();
      });

      var text = document.createElement('span');
      text.textContent = TYPE_STYLES[type].label;

      chip.appendChild(checkbox);
      chip.appendChild(text);
      self.dom.typeFilters.appendChild(chip);
    });
  };

  ViewerApp.prototype.applyTypeFilters = function() {
    this.entries.forEach(function(entry) {
      entry.layers.forEach(function(item) {
        var shouldShow = entry.visible && this.filterState[item.kind];
        if (shouldShow) {
          item.layer.addTo(this.map);
        } else {
          this.map.removeLayer(item.layer);
        }
      }, this);
    }, this);
  };

  ViewerApp.prototype.importFiles = async function(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    for (var index = 0; index < files.length; index += 1) {
      try {
        await this.importFile(files[index]);
      } catch (error) {
        this.refreshStatus((error && error.message) || ('読み込みに失敗しました: ' + files[index].name));
      }
    }
    this.refreshStatus();
  };

  ViewerApp.prototype.importFile = async function(file) {
    var lowerName = file.name.toLowerCase();
    if (/\.gpx$/i.test(lowerName) || file.type === 'application/gpx+xml' || file.type === 'application/xml' || file.type === 'text/xml') {
      return this.importGpxFile(file.name, await readTextFile(file));
    }
    if (/\.jpe?g$/i.test(lowerName) || file.type === 'image/jpeg') {
      return this.importJpegFile(file.name, file);
    }
    this.refreshStatus('未対応のファイル形式: ' + file.name);
  };

  ViewerApp.prototype.importUrlFromInput = function() {
    var self = this;
    var url = this.dom.urlInput.value.trim();
    if (!url) {
      return;
    }
    fetch(url)
      .then(function(response) {
        if (!response.ok) {
          throw new Error('URL の読み込みに失敗しました: ' + response.status);
        }
        return response.text();
      })
      .then(function(text) {
        return self.importGpxFile(url, text, { sourceUrl: url });
      })
      .catch(function(error) {
        self.refreshStatus(error.message);
      });
  };

  ViewerApp.prototype.consumeQueryUrls = function() {
    var params = new URLSearchParams(window.location.search);
    var urls = params.getAll('url');
    var self = this;
    urls.forEach(function(url) {
      self.dom.urlInput.value = url;
      self.importUrlFromInput();
    });
  };

  ViewerApp.prototype.importGpxFile = function(label, text, options) {
    var parsed = parseGpx(text);
    var entry = this.createEntry(label, 'GPX', options && options.sourceUrl ? options.sourceUrl : null);
    var summary = { waypoint: 0, route: 0, track: 0, photo: 0 };
    var bounds = [];
    var self = this;

    parsed.waypoints.forEach(function(waypoint) {
      var marker = L.marker([waypoint.lat, waypoint.lon], {
        icon: createColorMarker(TYPE_STYLES.waypoint.color)
      }).bindPopup(buildWaypointPopup(waypoint, waypoint.name || label));
      self.addLayerEntry(entry, marker, 'waypoint');
      summary.waypoint += 1;
      bounds.push([waypoint.lat, waypoint.lon]);
    });

    parsed.routes.forEach(function(route, routeIndex) {
      var latlngs = route.points.map(function(point) { return [point.lat, point.lon]; });
      var routeLayer = L.polyline(latlngs, {
        color: TYPE_STYLES.route.color,
        weight: 4,
        opacity: 0.8
      }).bindPopup('<strong>' + escapeHtml(route.name || ('Route ' + (routeIndex + 1))) + '</strong>');
      self.addLayerEntry(entry, routeLayer, 'route');
      summary.route += 1;
      bounds = bounds.concat(latlngs);
    });

    parsed.tracks.forEach(function(track, trackIndex) {
      track.segments.forEach(function(segment, segmentIndex) {
        var latlngs = segment.map(function(point) { return [point.lat, point.lon]; });
        var title = track.name || ('Track ' + (trackIndex + 1));
        var trackLayer = L.polyline(latlngs, {
          color: TYPE_STYLES.track.color,
          weight: 5,
          opacity: 0.72
        }).bindPopup('<strong>' + escapeHtml(title) + '</strong><br/>segment ' + (segmentIndex + 1));
        self.addLayerEntry(entry, trackLayer, 'track');
        summary.track += 1;
        bounds = bounds.concat(latlngs);
        self.indexTrackPoints(entry, track.name || label, segment);
      });
    });

    entry.summary = summary;
    entry.meta = summarizeCounts(summary) || '内容なし';
    this.entries.unshift(entry);
    this.renderLayerList();
    this.applyTypeFilters();
    if (bounds.length > 0) {
      this.map.fitBounds(bounds, { padding: [32, 32] });
    }
    this.refreshStatus(label + ' を追加しました');
  };

  ViewerApp.prototype.indexTrackPoints = function(entry, label, points) {
    points.forEach(function(point, index) {
      if (!point.time) {
        return;
      }
      var timelinePoint = {
        label: label,
        index: index,
        time: point.time,
        lat: point.lat,
        lon: point.lon,
        ele: point.ele
      };
      entry.timelinePoints.push(timelinePoint);
      this.trackTimeline.push(timelinePoint);
    }, this);

    this.trackTimeline.sort(function(left, right) {
      return left.time - right.time;
    });
  };

  ViewerApp.prototype.importJpegFile = async function(label, file) {
    var entry = this.createEntry(label, 'JPEG', null);
    var summary = { waypoint: 0, route: 0, track: 0, photo: 0 };
    var arrayBuffer = await readArrayBuffer(file);
    var metadata = await exifr.parse(arrayBuffer, {
      gps: true,
      tiff: true,
      exif: true
    });
    var coords = this.getPhotoCoordinates(metadata);
    var captureTimeResult = this.getPhotoDate(metadata);
    var captureTime = captureTimeResult.date;
    var inference = null;

    if (!coords && captureTime) {
      inference = this.findNearestTrackPoint(captureTimeResult.candidates);
      if (inference) {
        coords = { lat: inference.lat, lon: inference.lon };
        captureTime = inference.captureTime || captureTime;
      }
    }

    if (!coords) {
      this.refreshStatus(label + ' は位置を特定できませんでした');
      return;
    }

    var imageUrl = URL.createObjectURL(file);
    var marker = L.marker([coords.lat, coords.lon], {
      icon: createColorMarker(TYPE_STYLES.photo.color)
    });
    var popup = [
      '<div class="photo-popup">',
      '<strong>', escapeHtml(label), '</strong>',
      captureTime ? '<br/>撮影時刻: ' + escapeHtml(formatDate(captureTime)) : '',
      inference ? '<br/>位置推定: ' + escapeHtml(inference.label) + ' #' + escapeHtml(inference.index) : '',
      inference && inference.strategy ? '<br/>時刻解釈: ' + escapeHtml(inference.strategy) : '',
      '<br/><img src="', escapeHtml(imageUrl), '" alt="', escapeHtml(label), '" />',
      '</div>'
    ].join('');
    marker.bindPopup(popup);

    entry.objectUrls.push(imageUrl);
    this.addLayerEntry(entry, marker, 'photo');
    summary.photo = 1;
    entry.summary = summary;
    entry.meta = inference ? '写真 / GPX 時刻から位置推定 (' + inference.strategy + ')' : '写真 / EXIF GPS';
    this.entries.unshift(entry);
    this.renderLayerList();
    this.applyTypeFilters();
    this.map.flyTo([coords.lat, coords.lon], Math.max(this.map.getZoom(), 12));
    this.refreshStatus(label + ' を追加しました');
  };

  ViewerApp.prototype.getPhotoCoordinates = function(metadata) {
    if (!metadata) {
      return null;
    }
    if (typeof metadata.latitude === 'number' && typeof metadata.longitude === 'number') {
      return { lat: metadata.latitude, lon: metadata.longitude };
    }
    if (metadata.lat && metadata.lon) {
      return { lat: Number(metadata.lat), lon: Number(metadata.lon) };
    }
    return null;
  };

  ViewerApp.prototype.getPhotoDate = function(metadata) {
    var source = metadata ? (metadata.DateTimeOriginal || metadata.CreateDate || metadata.ModifyDate || null) : null;
    var candidates = [];
    var parts;

    if (!source) {
      return { date: null, candidates: [] };
    }

    if (source instanceof Date && !Number.isNaN(source.getTime())) {
      candidates.push({
        date: source,
        strategy: 'EXIF 既定解釈'
      });
    }

    parts = parseExifDateText(source);
    if (parts) {
      candidates.push({
        date: buildDateFromParts(parts, JST_OFFSET_MINUTES),
        strategy: 'EXIF を JST として解釈'
      });
      candidates.push({
        date: buildDateFromParts(parts, -new Date().getTimezoneOffset()),
        strategy: 'EXIF をブラウザのローカル時刻として解釈'
      });
    }

    candidates = candidates.filter(function(candidate, index, array) {
      if (!(candidate.date instanceof Date) || Number.isNaN(candidate.date.getTime())) {
        return false;
      }
      return array.findIndex(function(other) {
        return other.date.getTime() === candidate.date.getTime();
      }) === index;
    });

    return {
      date: candidates.length ? candidates[0].date : null,
      candidates: candidates
    };
  };

  ViewerApp.prototype.findNearestTrackPoint = function(candidates) {
    if (!this.trackTimeline.length || !candidates || !candidates.length) {
      return null;
    }
    var best = null;
    var bestDiff = Infinity;
    candidates.forEach(function(candidate) {
      this.trackTimeline.forEach(function(point) {
        var diff = Math.abs(point.time - candidate.date);
        if (diff < bestDiff) {
          best = {
            label: point.label,
            index: point.index,
            time: point.time,
            lat: point.lat,
            lon: point.lon,
            ele: point.ele,
            strategy: candidate.strategy,
            captureTime: candidate.date,
            diffMs: diff
          };
          bestDiff = diff;
        }
      });
    }, this);
    return best && bestDiff <= PHOTO_TIME_MATCH_LIMIT_MS ? best : null;
  };

  ViewerApp.prototype.createEntry = function(label, sourceType, sourceUrl) {
    return {
      id: 'entry-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      label: label,
      sourceType: sourceType,
      sourceUrl: sourceUrl,
      createdAt: new Date(),
      visible: true,
      layers: [],
      timelinePoints: [],
      objectUrls: [],
      summary: { waypoint: 0, route: 0, track: 0, photo: 0 },
      meta: ''
    };
  };

  ViewerApp.prototype.addLayerEntry = function(entry, layer, kind) {
    entry.layers.push({ layer: layer, kind: kind });
  };

  ViewerApp.prototype.renderLayerList = function() {
    var self = this;
    this.dom.layerList.innerHTML = '';

    if (!this.entries.length) {
      this.dom.layerList.innerHTML = '<p class="panel-note">まだ何も読み込まれていません。</p>';
      return;
    }

    this.entries.forEach(function(entry) {
      var card = document.createElement('article');
      card.className = 'layer-item';
      card.dataset.hidden = String(!entry.visible);

      var header = document.createElement('div');
      header.className = 'layer-item__header';

      var title = document.createElement('p');
      title.className = 'layer-item__title';
      title.textContent = entry.label;

      var pill = document.createElement('span');
      pill.className = 'layer-pill';
      pill.textContent = entry.sourceType;

      header.appendChild(title);
      header.appendChild(pill);

      var meta = document.createElement('div');
      meta.className = 'layer-item__meta';
      meta.innerHTML = '<span>' + escapeHtml(entry.meta || '読み込み済み') + '</span><span>' + escapeHtml(formatDate(entry.createdAt)) + '</span>';

      var footer = document.createElement('div');
      footer.className = 'layer-item__foot';

      var toggleLabel = document.createElement('label');
      toggleLabel.className = 'type-chip';

      var toggle = document.createElement('input');
      toggle.className = 'layer-toggle';
      toggle.type = 'checkbox';
      toggle.checked = entry.visible;
      toggle.addEventListener('change', function() {
        entry.visible = toggle.checked;
        self.applyTypeFilters();
        card.dataset.hidden = String(!entry.visible);
      });

      var toggleText = document.createElement('span');
      toggleText.textContent = '表示';
      toggleLabel.appendChild(toggle);
      toggleLabel.appendChild(toggleText);

      var removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'remove-button';
      removeButton.textContent = '削除';
      removeButton.addEventListener('click', function() {
        self.removeEntry(entry.id);
      });

      footer.appendChild(toggleLabel);
      footer.appendChild(removeButton);

      card.appendChild(header);
      card.appendChild(meta);
      card.appendChild(footer);
      self.dom.layerList.appendChild(card);
    });
  };

  ViewerApp.prototype.removeEntry = function(entryId) {
    var entryIndex = this.entries.findIndex(function(entry) { return entry.id === entryId; });
    if (entryIndex < 0) {
      return;
    }
    var entry = this.entries[entryIndex];
    entry.layers.forEach(function(item) {
      this.map.removeLayer(item.layer);
    }, this);
    entry.objectUrls.forEach(function(url) {
      URL.revokeObjectURL(url);
    });
    this.entries.splice(entryIndex, 1);
    this.rebuildTrackTimeline();
    this.renderLayerList();
    this.refreshStatus(entry.label + ' を削除しました');
  };

  ViewerApp.prototype.rebuildTrackTimeline = function() {
    this.trackTimeline = [];
    this.entries.forEach(function(entry) {
      this.trackTimeline = this.trackTimeline.concat(entry.timelinePoints);
    }, this);
    this.trackTimeline.sort(function(left, right) {
      return left.time - right.time;
    });
  };

  ViewerApp.prototype.fitAll = function() {
    var bounds = [];
    this.entries.forEach(function(entry) {
      entry.layers.forEach(function(item) {
        if (!entry.visible || !this.filterState[item.kind]) {
          return;
        }
        if (typeof item.layer.getLatLng === 'function') {
          var point = item.layer.getLatLng();
          bounds.push([point.lat, point.lng]);
        } else if (typeof item.layer.getLatLngs === 'function') {
          item.layer.getLatLngs().forEach(function(latlng) {
            bounds.push([latlng.lat, latlng.lng]);
          });
        }
      }, this);
    }, this);
    if (bounds.length) {
      this.map.fitBounds(bounds, { padding: [32, 32] });
    }
  };

  ViewerApp.prototype.clearAll = function() {
    while (this.entries.length) {
      this.removeEntry(this.entries[0].id);
    }
    this.refreshStatus('すべて削除しました');
  };

  ViewerApp.prototype.refreshStatus = function(message) {
    if (message) {
      this.dom.statusText.textContent = message;
      return;
    }
    this.dom.statusText.textContent = this.entries.length ? this.entries.length + ' 件読み込み済み' : 'まだデータはありません';
  };

  document.addEventListener('DOMContentLoaded', function() {
    var app = new ViewerApp();
    app.start();
  });
})();