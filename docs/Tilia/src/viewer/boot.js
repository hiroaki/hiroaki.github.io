import { createTiliaCore } from "../core/boot.js";
import { setError } from "../core/state.js";
import { createBaseMap } from "../map/base.js";
import { installDropzonePlugin } from "../plugins/input/dropzone.js";
import { installFileImportControl } from "../plugins/input/file-import.js";
import { installUrlImportControl } from "../plugins/input/url-import.js";
import { installElevationPanelControl } from "../plugins/ui/elevation-panel.js";
import { installLayersControl } from "../plugins/ui/layers-control.js";
import { installPanelPlugin } from "../plugins/ui/panel.js";
import { installSettingsPanelControl } from "../plugins/ui/settings-panel.js";
import { installStatusControl } from "../plugins/ui/status-control.js";

export function bootViewer() {
  const { map } = createBaseMap("map");
  const core = createTiliaCore(map);
  const { state, registry, context } = core;
  const panel = installPanelPlugin({ map });
  const statusControl = installStatusControl({ map });
  const updateStatus = (text) => {
    statusControl.setStatus(text);
  };

  const layersControl = installLayersControl({
    map,
    core,
    panel,
    onStatus: updateStatus,
    onError: (error) => setError(state, error),
    onEntriesChanged: () => {
      elevationControl.refresh();
    },
  });

  const elevationControl = installElevationPanelControl({
    map,
    core,
    panel,
    onStatus: updateStatus,
  });

  installFileImportControl({
    map,
    registry,
    context,
    onStatus: updateStatus,
    onError: (error) => setError(state, error),
    onItemLoaded: () => {
      layersControl.render();
      elevationControl.refresh();
    },
  });

  installUrlImportControl({
    map,
    registry,
    context,
    onStatus: updateStatus,
    onError: (error) => setError(state, error),
    onItemLoaded: () => {
      layersControl.render();
      elevationControl.refresh();
    },
  });

  installSettingsPanelControl({
    map,
    core,
    panel,
    onStatus: updateStatus,
  });

  const dropTarget = map.getContainer();
  installDropzonePlugin({
    dropTarget,
    registry,
    context,
    onStatus: updateStatus,
    onError: (error) => setError(state, error),
    onItemLoaded: () => {
      layersControl.render();
      elevationControl.refresh();
    },
  });

  layersControl.render();
  elevationControl.refresh();
}
