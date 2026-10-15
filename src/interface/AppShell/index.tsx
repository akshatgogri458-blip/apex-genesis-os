declare const React: any;

export const V7AppShell = (props: Record<string, any>) => {
  return React.createElement('div', { className: 'v7-ui-appshell' }, props.children);
};
