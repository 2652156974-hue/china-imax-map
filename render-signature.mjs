import { markerRenderDescriptor } from './marker-render-descriptor.mjs';

export function displayRenderSignature({ lifecycle = 'current', mode = 'province', items = [] } = {}) {
  return JSON.stringify({
    lifecycle,
    mode,
    items: items.map((item) => markerRenderDescriptor(item, lifecycle))
  });
}
