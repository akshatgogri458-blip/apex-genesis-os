declare const React: any;

export const NeuralWorld = (props: Record<string, any>) => {
  return React.createElement('section', { className: 'v7-scene-neuralworld', 'data-scene': 'NeuralWorld' }, props.children);
};
