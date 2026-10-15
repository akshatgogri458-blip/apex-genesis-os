declare const React: any;

export const SpatialCanvas = (props: Record<string, any>) => {
  return React.createElement('div', { className: 'v7-spatialcanvas', 'data-component': 'SpatialCanvas' }, props.children);
};
