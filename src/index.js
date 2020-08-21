import { subscribe, pipe, emitter, Observable } from "agos";

const noop = () => {};

export const createState = state => {
  let _state = state;
  const [control, subject] = emitter({ immediate: true });
  control.open();
  control.next(_state);
  return [
    subject,
    data => {
      if (typeof data === "function") _state = data(_state);
      else _state = data;
      control.next(_state);
    }
  ];
};

class GuhitNode {
  constructor(node, properties = {}, onMount = () => {}) {
    this.node = node;
    this.onMount = element => {
      const propertyKeys = Object.keys(properties);

      const [control, subject] = emitter();
      for (let index = 0; index < propertyKeys.length; index++) {
        const propertyKey = propertyKeys[index];
        const propertyValue = properties[propertyKey];

        if (propertyValue instanceof Observable) {
          pipe(
            propertyValue,
            subscribe(data => {
              element[propertyKey] = data;
            }, subject)
          );
        } else {
          element[propertyKey] = propertyValue;
        }
      }

      const unmount = (onMount && onMount(element)) || noop;

      return () => {
        control.next([Observable.CANCEL]);
        unmount();
      };
    };
  }
}

class GuhitText extends GuhitNode {
  constructor(text, properties, mount) {
    super(document.createTextNode(text), properties, mount);
  }
}

class GuhitElement extends GuhitNode {
  constructor(name, attributes, properties, children, onMount) {
    const element = document.createElement(name);
    super(element, properties, element => {
      const attributeKeys = Object.keys(attributes);
      // const propertyKeys = Object.keys(properties);

      const [control, subject] = emitter();
      for (let index = 0; index < attributeKeys.length; index++) {
        const attributeKey = attributeKeys[index];
        const attributeValue = attributes[attributeKey];

        if (attributeValue instanceof Observable) {
          pipe(
            attributeValue,
            subscribe(data => {
              element.setAttribute(attributeKey, data);
            }, subject)
          );
        } else {
          element.setAttribute(attributeKey, attributeValue);
        }
      }

      const unmountChildren = mount(element, children);
      const unmount = (onMount && onMount(element)) || noop;

      return () => {
        control.next([Observable.CANCEL]);
        unmountChildren();
        unmount();
      };
    });
  }
}

export const e = (name, attributes, properties, children, onMount) =>
  new GuhitElement(name, attributes, properties, children, onMount);

export const t = (text, onMount) => new GuhitText(text, onMount);

// children
// - observable -> observable that emits a children type
// - element -> insert or replace the child with the element and run the mount
// - null -> delete the child and run unmount
// - else -> create a text element
export const mount = (parent, children) => {
  const nodes = [];
  const cleanups = [];
  const [control, subject] = emitter();

  const insert = (child, index) => {
    if (!nodes[index]) {
      // insert
      let _index = index + 1;

      while (!nodes[_index] && _index <= nodes.length) _index++;

      parent.insertBefore(child.node, nodes[_index] && nodes[_index].node);
    } else {
      const cleanup = cleanups[index];
      cleanup && cleanup();
      // replace
      parent.replaceChild(child.node, nodes[index] && nodes[index].node);
    }
    nodes[index] = child;
    cleanups[index] = child.onMount(child.node);
  };

  const remove = index => {
    if (!nodes[index]) return;
    // needs to remove or clean up observables
    parent.removeChild(nodes[index].node);
    nodes[index] = null;
    const cleanup = cleanups[index];

    if (cleanup) {
      cleanup();
      cleanups[index] = null;
    }
  };

  children = Array.isArray(children) ? children : [children];

  for (let index = 0; index < children.length; index++) {
    nodes[index] = null;
    cleanups[index] = null;

    const child = children[index];

    if (child instanceof Observable) {
      pipe(
        child,
        subscribe(data => {
          if (data instanceof GuhitNode) {
            insert(data, index);
          } else if (data === null) {
            remove(index);
          } else {
            insert(t(data), index);
          }
        }, subject)
      );
    } else if (child instanceof GuhitNode) {
      insert(child, index);
    } else if (child !== null) {
      insert(t(child), index);
    }
  }

  return () => {
    control.next([Observable.CANCEL]);
    for (let index = 0; index < cleanups.length; index++) {
      cleanups[index]();
      cleanups[index] = null;
    }

    for (let index = 0; index < nodes.length; index++) {
      nodes[index] = null;
    }
  };
};
