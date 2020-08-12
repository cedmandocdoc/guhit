import { listen, pipe, emitter, CANCEL } from "agos";

const noop = () => {};

export const subscribe = (sink, external) => {
  if (typeof sink === "function")
    return listen(noop, sink, noop, noop, external);
  return listen(sink.open, sink.next, sink.fail, sink.done, external);
};

export const mount = (root, destination) => {
  const [element, mount] = root;
  destination.appendChild(element);
  mount();
};

export const createState = state => {
  let _state = state;
  const [control, subject] = emitter();
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

export const h = (name, attributes, children, mount = () => {}) => {
  const element = document.createElement(name);
  const keys = Object.keys(attributes);

  const [control, subject] = emitter();
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    const source = attributes[key];
    pipe(
      source,
      subscribe(data => {
        element.setAttribute(key, data);
      }, subject)
    );
  }

  const _children = [];
  const _cleanups = [];

  const insert = (index, child, mount) => {
    if (!_children[index]) {
      // insert
      let _index = index + 1;

      while (!_children[_index] && _index <= _children.length) _index++;
      element.insertBefore(child, _children[_index]);
    } else {
      // replace
      element.replaceChild(child, _children[index]);
    }
    _children[index] = child;
    _cleanups[index] = mount();
  };

  const remove = index => {
    if (!_children[index]) return;
    // needs to remove or clean up observables
    _children[index].remove();
    _children[index] = null;
    _cleanups[index] && _cleanups[index]();
    _cleanups[index] = null;
  };

  for (let index = 0; index < children.length; index++) {
    _children[index] = null;
    _cleanups[index] = null;
    const child = children[index];
    if (typeof child === "string" || typeof child === "number")
      insert(index, document.createTextNode(child), () => {});
    else if (child instanceof Array) insert(index, child[0], child[1]);
    else {
      pipe(
        child,
        subscribe(data => {
          if (typeof data === "string" || typeof data === "number")
            insert(index, document.createTextNode(data), () => {});
          else if (data instanceof Array) insert(index, data[0], data[1]);
          else if (data === null || data === false || data === undefined)
            remove(index);
        }, subject)
      );
    }
  }

  const cleanup = () => {
    control.next([CANCEL]);
    for (let index = 0; index < _cleanups.length; index++) {
      const clean = _cleanups[index];
      clean && clean();
    }
    for (let index = 0; index < _children.length; index++) {
      _children[index] = null;
    }
  };

  return [
    element,
    () => {
      const _c = mount();
      return () => {
        cleanup();
        _c();
      };
    }
  ];
};
