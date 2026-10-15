declare const React: any;

export const V7Components = (props: Record<string, any>) => {
  return React.createElement('div', { className: 'v7-ui-components' }, props.children);
};
