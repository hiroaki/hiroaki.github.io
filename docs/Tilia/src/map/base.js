import { Map as LeafletMap, TileLayer } from "leaflet";

export function createBaseMap(containerId) {
  const map = new LeafletMap(containerId, {
    closePopupOnClick: false,
    zoomControl: true,
  });

  map.setView([35.681236, 139.767125], 10);

  const tileLayer = new TileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  });
  tileLayer.addTo(map);

  return { map, tileLayer };
}
