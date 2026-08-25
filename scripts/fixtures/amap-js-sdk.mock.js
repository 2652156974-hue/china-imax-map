(() => {
  class MockMap {
    constructor(container, options = {}) {
      this.container = typeof container === 'string' ? document.getElementById(container) : container;
      this.zoom = options.zoom ?? 4;
      this.center = options.center ?? [104, 35];
      this.style = options.mapStyle ?? '';
      this.container.dataset.mockAmap = 'ready';
    }
    addControl() {}
    getZoom() { return this.zoom; }
    setMapStyle(style) { this.style = style; this.container.dataset.mapStyle = style; }
    setZoomAndCenter(zoom, center) {
      this.zoom = zoom;
      this.center = Array.isArray(center) ? center : [center.lng, center.lat];
      this.container.dataset.zoom = String(zoom);
    }
  }

  class MockMarker {
    constructor(position) {
      this.position = position;
      this.listeners = new Map();
      this.element = document.createElement('div');
      this.element.className = 'mock-amap-marker';
    }
    setContent(content) { this.element.innerHTML = content; }
    setOffset() {}
    getPosition() { return this.position; }
    off(event) {
      const listener = this.listeners.get(event);
      if (listener) this.element.removeEventListener(event, listener);
      this.listeners.delete(event);
    }
    on(event, listener) {
      this.off(event);
      this.listeners.set(event, listener);
      this.element.addEventListener(event, listener);
    }
    mount(container) { container.append(this.element); }
  }

  class MarkerCluster {
    constructor(map, data, options = {}) {
      this.map = map;
      this.options = options;
      this.layer = document.createElement('div');
      this.layer.id = 'mock-amap-cluster-layer';
      this.map.container.append(this.layer);
      this.setData(data);
    }
    setData(data) {
      this.data = data;
      this.layer.replaceChildren();
      if (!data.length) return;
      if (data.length > 24) {
        const clusterMarker = new MockMarker(data[0].lnglat);
        this.options.renderClusterMarker?.({
          marker: clusterMarker,
          count: data.length,
          clusterData: data
        });
        clusterMarker.mount(this.layer);
      }
      for (const datum of data.slice(0, 24)) {
        const marker = new MockMarker(datum.lnglat);
        this.options.renderMarker?.({ marker, data: datum });
        marker.mount(this.layer);
      }
      this.layer.dataset.totalPoints = String(data.length);
    }
  }

  class InfoWindow {
    constructor() { this.content = ''; }
    setContent(content) { this.content = content; }
    open(map) {
      this.close();
      this.element = document.createElement('div');
      this.element.id = 'mock-amap-info-window';
      this.element.innerHTML = this.content;
      map.container.append(this.element);
    }
    close() { this.element?.remove(); }
  }

  class Pixel {
    constructor(x, y) { this.x = x; this.y = y; }
  }

  window.AMap = {
    Map: MockMap,
    MarkerCluster,
    InfoWindow,
    Pixel,
    ToolBar: class ToolBar {},
    Scale: class Scale {}
  };
})();
