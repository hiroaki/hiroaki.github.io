import { createTiliaCore } from "../../src/core/boot.js";
import { setError } from "../../src/core/state.js";
import { createBaseMap } from "../../src/map/base.js";
import { installDropzonePlugin } from "../../src/plugins/input/dropzone.js";
import { installFileImportControl } from "../../src/plugins/input/file-import.js";
import { installUrlImportControl } from "../../src/plugins/input/url-import.js";
import { installElevationPanelControl } from "../../src/plugins/ui/elevation-panel.js";
import { installLayersControl } from "../../src/plugins/ui/layers-control.js";
import { installPanelPlugin } from "../../src/plugins/ui/panel.js";
import { installSettingsPanelControl } from "../../src/plugins/ui/settings-panel.js";
import { installStatusControl } from "../../src/plugins/ui/status-control.js";

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
