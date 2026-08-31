(() => {
  class MockMap {
    constructor(container, options = {}) {
      this.container = typeof container === 'string' ? document.getElementById(container) : container;
      this.zoom = options.zoom ?? 4;
      this.center = options.center ?? [104, 35];
      this.pitch = options.pitch ?? 0;
      this.rotation = options.rotation ?? 0;
      this.style = options.mapStyle ?? '';
      this.listeners = new Map();
      this.markers = new Set();
      this.container.dataset.mockAmap = 'ready';
      this.container.dataset.zoom = String(this.zoom);
      this.container.dataset.mapCenter = this.center.join(',');
      window.addEventListener('resize', () => this.renderMarkers());
    }
    addControl() {}
    getZoom() { return this.zoom; }
    getCenter() {
      const [lng, lat] = this.center;
      return { lng, lat, getLng: () => lng, getLat: () => lat };
    }
    getPitch() { return this.pitch; }
    getRotation() { return this.rotation; }
    setPitch(pitch) { this.pitch = Number(pitch); }
    setRotation(rotation) { this.rotation = Number(rotation); }
    setMapStyle(style) { this.style = style; this.container.dataset.mapStyle = style; }
    setZoomAndCenter(zoom, center) {
      const previousZoom = this.zoom;
      this.zoom = zoom;
      this.center = Array.isArray(center) ? center : [center.lng, center.lat];
      this.container.dataset.zoom = String(zoom);
      this.container.dataset.mapCenter = this.center.join(',');
      this.renderMarkers();
      if (previousZoom !== this.zoom) this.emit('zoomend', { zoom: this.zoom });
    }
    on(event, listener) {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(listener);
      this.listeners.set(event, listeners);
      return this;
    }
    off(event, listener) {
      if (!listener) {
        this.listeners.delete(event);
        return this;
      }
      const listeners = this.listeners.get(event);
      listeners?.delete(listener);
      if (listeners?.size === 0) this.listeners.delete(event);
      return this;
    }
    emit(event, payload = {}) {
      for (const listener of this.listeners.get(event) ?? []) listener(payload);
      return this;
    }
    lngLatToContainer(lnglat) {
      const point = Array.isArray(lnglat) ? lnglat : [lnglat?.lng, lnglat?.lat];
      const lng = Number(point[0]);
      const lat = Number(point[1]);
      const width = this.container?.clientWidth || 1024;
      const height = this.container?.clientHeight || 768;
      const scale = 12 * (2 ** (this.zoom - 4));
      return {
        x: width / 2 + (lng - Number(this.center[0])) * scale,
        y: height / 2 + (Number(this.center[1]) - lat) * scale
      };
    }
    renderMarkers() {
      for (const marker of this.markers) marker.renderPosition();
    }
  }

  class MockMarker {
    constructor(options = {}) {
      const isPosition = Array.isArray(options) || (options && typeof options.getLng === 'function');
      this.position = isPosition ? options : options.position;
      this.map = null;
      this.options = isPosition ? {} : options;
      this.offset = null;
      this.listeners = new Map();
      this.element = document.createElement('div');
      this.element.className = 'mock-amap-marker';
      if (!isPosition && options.content) this.setContent(options.content);
      if (!isPosition && options.map) this.setMap(options.map);
    }
    setContent(content) { this.element.innerHTML = content; }
    setOffset(offset) { this.offset = offset; this.renderPosition(); }
    setPosition(position) { this.position = position; this.renderPosition(); }
    getPosition() { return this.position; }
    setMap(map) {
      this.map?.markers?.delete(this);
      this.element.remove();
      this.map = map;
      if (map?.container) {
        map.markers?.add(this);
        map.container.append(this.element);
        this.renderPosition();
      }
    }
    renderPosition() {
      if (!this.map?.container) return;
      const point = this.map.lngLatToContainer(this.position);
      const offsetX = Number(this.offset?.x) || 0;
      const offsetY = Number(this.offset?.y) || 0;
      const width = this.map.container.clientWidth || 1024;
      const height = this.map.container.clientHeight || 768;
      this.element.style.position = 'absolute';
      this.element.style.left = `${point.x + offsetX}px`;
      this.element.style.top = `${point.y + offsetY}px`;
      this.element.style.zIndex = String(this.options.zIndex ?? 1);
      this.element.style.display = point.x < -100 || point.x > width + 100 || point.y < -100 || point.y > height + 100 ? 'none' : '';
    }
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

  class MockGeolocation {
    constructor(options = {}) { this.options = options; }
    getCurrentPosition(callback) {
      const configured = window.__mockAmapGeolocation ?? {
        status: 'error',
        result: { info: 'PERMISSION_DENIED' }
      };
      setTimeout(() => callback(configured.status, configured.result ?? {}), 0);
    }
  }

  window.AMap = {
    Map: MockMap,
    Marker: MockMarker,
    InfoWindow,
    Pixel,
    Geolocation: MockGeolocation,
    ToolBar: class ToolBar {},
    Scale: class Scale {}
  };
})();
