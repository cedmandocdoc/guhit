import {
  CancelInterceptor,
  create,
  emitter,
  empty,
  filter,
  listen,
  map,
  merge,
  multicast,
  pairwise,
  pipe,
  Stream,
  switchMap,
  take
} from "agos";

/**
 * Observable constructor
 * for event listening
 * @param {HTMLElement} target
 * @param {string} name
 * @param {boolean|AddEventListenerOptions|null} options
 * @returns {Stream}
 */
export const fromEvent = (target, name, options) =>
  create((open, next, fail, done, talkback) => {
    open();
    if (!target) return;
    target.addEventListener(name, next, options);

    pipe(
      talkback,
      filter(payload => payload === Stream.CANCEL),
      listen(() => {
        target.removeEventListener(name, next);
        done(true);
      })
    );
  });

/**
 * Observable operator that acts as a gate
 * comparing prev values to the current one
 * optional comparator function can be passed
 * if no comparator the directly check curr and prev
 * @param {(any, any) => boolean} comparator
 * @returns {Stream}
 */
export const distinct = (
  comparator = (prev, curr) => prev === curr
) => stream => {
  const single = multicast(stream, { immediate: true });
  return merge([
    pipe(single, take(1)),
    pipe(
      stream,
      pairwise(),
      filter(([prev, curr]) => !comparator(prev, curr)),
      map(([, curr]) => curr)
    )
  ]);
};

const diffObject = (objA, objB) => {
  const left = {};
  const right = {};
  Object.keys(objB).forEach(keyB => {
    if (objB[keyB] !== objA[keyB]) {
      right[keyB] = objB[keyB];
    }
  });

  Object.keys(objA).forEach(keyA => {
    if (objA[keyA] !== objB[keyA]) {
      left[keyA] = objA[keyA];
    }
  });

  return [left, right];
};

class Ref {
  constructor() {
    const [control, subject] = emitter({ immediate: true });
    this.control = control;
    this.subject = subject;
  }
}

class VNode {
  constructor(ref) {
    this.ref = ref;
  }
}

class VText extends VNode {
  constructor(text, ref) {
    super(ref);
    this.text = `${text}`;
  }
}

class VElement extends VNode {
  constructor(name, props = {}, children) {
    const { ref = null, style = {}, innerHTML = null } = props;
    super(ref);
    this.name = name;
    this.style = style;
    this.attrs = {};
    this.events = {};
    this.innerHTML = innerHTML;
    this.children = this.innerHTML ? [] : getSafeVNodes(children);
    // somehow rest operator is not working in buble loader :( sad
    // this should iterate props withough ref and style
    Object.keys(props).forEach(key => {
      const value = props[key];
      if (key === "ref" || key === "style") return;
      else if (key.slice(0, 2) === "on") this.events[key.slice(2)] = value;
      else this.attrs[key] = value;
    });
  }
}

const createText = vtext => document.createTextNode(vtext.text);

const createElement = velement => document.createElement(velement.name);

const createNode = vnode => {
  if (vnode instanceof VText) return createText(vnode);
  if (vnode instanceof VElement) return createElement(vnode);
  throw new Error("Cannot create node, invalid vnode");
};

const mountNodeAttrs = (attrs, unmounts, node) => {
  Object.keys(attrs).forEach(key => {
    const attr = attrs[key];
    if (attr === null || attr === undefined) return;
    if (!(attr instanceof Stream)) return node.setAttribute(key, attr);
    const cancel = CancelInterceptor.join(empty());
    unmounts.set(key, () => cancel.run());
    pipe(
      attr,
      distinct(),
      listen(data => node.setAttribute(key, data), cancel)
    );
  });
};

const mountNodeStyle = (style, unmounts, node) => {
  Object.keys(style).forEach(key => {
    const value = style[key];
    if (value === null || value === undefined) return;
    if (!(value instanceof Stream)) return (node.style[key] = value);
    const cancel = CancelInterceptor.join(empty());
    unmounts.set(key, () => cancel.run());
    pipe(
      value,
      distinct(),
      listen(data => (node.style[key] = data), cancel)
    );
  });
};

const mountNodeEvents = (events, unmounts, node) => {
  Object.keys(events).forEach(key => {
    const event = events[key];
    if (event === null || event === undefined) return;
    if (typeof event !== "function") return;
    const cancel = CancelInterceptor.join(empty());
    unmounts.set(key, () => cancel.run());
    pipe(
      fromEvent(node, key),
      listen(data => event(data), cancel)
    );
  });
};

const unmountNodeAttrs = (attrs, unmounts, node) => {
  Object.keys(attrs).forEach(key => {
    node.removeAttribute(key);
    const unmount = unmounts.get(key);
    if (unmount) {
      unmount();
      unmounts.delete(key);
    }
  });
};

const unmountNodeStyle = (style, unmounts, node) => {
  Object.keys(style).forEach(key => {
    node.style.removeProperty(key);
    const unmount = unmounts.get(key);
    if (unmount) {
      unmount();
      unmounts.delete(key);
    }
  });
};

const unmountNodeEvents = (events, unmounts) => {
  Object.keys(events).forEach(key => {
    const unmount = unmounts.get(key);
    if (unmount) {
      unmount();
      unmounts.delete(key);
    }
  });
};

const mountNodeProps = (velement, unmounts, node) => {
  mountNodeAttrs(velement.attrs, unmounts.attrs, node);
  mountNodeStyle(velement.style, unmounts.style, node);
  mountNodeEvents(velement.events, unmounts.events, node);
  if (velement.innerHTML) node.innerHTML = velement.innerHTML;
};

const unmountNodeProps = (velement, unmounts, node) => {
  unmountNodeAttrs(velement.attrs, unmounts.attrs, node);
  unmountNodeStyle(velement.style, unmounts.style, node);
  unmountNodeEvents(velement.events, unmounts.events);
};

const createChildText = vtext => {
  const node = createNode(vtext);
  return { vnode: vtext, node };
};

const createChildElement = velement => {
  const node = createNode(velement);
  const unmounts = { attrs: new Map(), style: new Map(), events: new Map() };
  mountNodeProps(velement, unmounts, node);

  // recursively mount the children
  const control = mount(node, velement.children);
  return { vnode: velement, node, control, unmounts };
};

const createChildNode = vnode => {
  if (vnode instanceof VText) return createChildText(vnode);
  if (vnode instanceof VElement) return createChildElement(vnode);
  throw new Error("Cannot create child, invalid vnode");
};

// use to diff a vnode
const diffVNode = (vnodeA, vnodeB) => {
  // tag name difference
  if (
    vnodeA instanceof VElement &&
    vnodeB instanceof VElement &&
    vnodeA.name !== vnodeB.name
  )
    return "replace";

  // type difference
  if (
    (vnodeA instanceof VElement && vnodeB instanceof VText) ||
    (vnodeA instanceof VText && vnodeB instanceof VElement)
  )
    return "replace";

  if (
    vnodeA instanceof VText &&
    vnodeB instanceof VText &&
    vnodeA.text !== vnodeB.text
  )
    return "text";

  return "none";
};

// use to diff prev and latest vnodes
const diffVNodes = (prevs, latests) => {
  const additionals = [];
  const removals = [];
  const elements = [];
  const texts = [];

  prevs.forEach((vnode, index) => {
    const prev = vnode;
    const latest = latests[index];

    if (!latest) return removals.push({ vnode, index });
    if (latest instanceof Stream) {
      removals.push({ vnode, index });
      additionals.push({ vnode: latest, index });
      return;
    }
    if (prev instanceof Stream)
      return additionals.push({ vnode: latest, index });

    const diffType = diffVNode(prev, latest);
    if (diffType === "replace") {
      removals.push({ vnode, index });
      additionals.push({ vnode: latest, index });
      return;
    }
    if (diffType === "text") {
      texts.push({ vnode: latest, index });
      return;
    }
    if (latest instanceof VElement) elements.push({ vnode: latest, index });
  });

  const offsetIndex = prevs.length;
  const excess = latests.slice(offsetIndex);

  excess.forEach((vnode, index) =>
    additionals.push({ vnode, index: index + offsetIndex })
  );

  return {
    additionals,
    removals,
    elements,
    texts
  };
};

const getSafeVNodes = vnodes => {
  return (vnodes instanceof Array ? vnodes : [vnodes])
    .filter(vnode => vnode !== null && vnode !== undefined)
    .map(child =>
      child instanceof Stream || child instanceof VNode ? child : t(child)
    );
};

const getHeadSpaceKey = (spaces, space) => {
  let headSpaceKey = null;
  spaces.forEach((_, spacekey) => {
    if (spacekey <= space) return;
    if (headSpaceKey === null || headSpaceKey > spacekey)
      headSpaceKey = spacekey;
  });
  return headSpaceKey;
};

const getHeadPositionKey = (positions, position) => {
  let headPositionKey = null;
  positions.forEach((value, positionKey) => {
    if (value === null) return;
    if (positionKey <= position) return;
    // impossible to have an equal headPosition and positionKey
    if (headPositionKey === null || headPositionKey > positionKey)
      headPositionKey = positionKey;
  });
  return headPositionKey;
};

const getLargestPositionKey = positions =>
  Math.max(...Array.from(positions.keys()));

const getSmallestPositionKey = positions =>
  Math.min(...Array.from(positions.keys()));

const mountVNodes = (vnodes, cancellations, insert, remove, move) => {
  vnodes.forEach(({ vnode, index }) => {
    if (vnode instanceof Stream) {
      const cancel = mountChildStream(
        vnode,
        // insert should return a value
        (child, position) => insert(child, index, position),
        position => remove(index, position),
        (position, length) => move(index, position, length)
      );
      cancellations.set(vnode, cancel);
      return;
    }
    insert(createChildNode(vnode), index, 0);
  });
};

// decide whether to remount or add a node
// this has a flow of remove first, update then and add the additionals
const remountVNodes = (
  spaces,
  prevs,
  latests,
  cancellations,
  insert,
  remove,
  move
) => {
  // for every remount all stream child cancellation
  // should run because it needs to be reset
  cancellations.forEach(cancel => cancel());
  cancellations.clear();

  const { additionals, elements, texts, removals } = diffVNodes(prevs, latests);

  removals.forEach(({ index }) => remove(index, 0));

  texts.forEach(({ vnode, index }) => {
    const child = spaces.get(index).get(0);
    child.vnode.text = vnode.text;
    child.node.textContent = vnode.text;
  });

  elements.forEach(({ vnode, index }) => {
    const child = spaces.get(index).get(0);

    // recursively update VElement
    updateVElement(child, vnode, index);
    child.vnode = vnode;
  });

  // mount the additionals
  mountVNodes(additionals, cancellations, insert, remove, move);
};

// updating velement this has the diffing of props and diffing of children
const updateVElement = (child, vnode) => {
  const attrs = child.vnode.attrs;
  const style = child.vnode.style;
  const events = child.vnode.events;

  const attrsStream = {};
  const styleStream = {};

  const attrsConst = {};
  const styleConst = {};

  Object.keys(attrs).forEach(key => {
    if (attrs[key] instanceof Stream) attrsStream[key] = attrs[key];
    else attrsConst[key] = attrs[key];
  });
  Object.keys(style).forEach(key => {
    if (style[key] instanceof Stream) styleStream[key] = style[key];
    else styleConst[key] = style[key];
  });

  unmountNodeAttrs(attrsStream, child.unmounts.attrs, child.node);
  unmountNodeStyle(styleStream, child.unmounts.style, child.node);

  const [leftAttrsDiff, rightAttrsDiff] = diffObject(attrsConst, vnode.attrs);
  const [leftStyleDiff, rightStyleDiff] = diffObject(styleConst, vnode.style);
  const [leftEventsDiff, rightEventsDiff] = diffObject(events, vnode.events);

  unmountNodeAttrs(leftAttrsDiff, child.unmounts.attrs, child.node);
  unmountNodeAttrs(leftStyleDiff, child.unmounts.style, child.node);
  unmountNodeEvents(leftEventsDiff, child.unmounts.events);

  mountNodeAttrs(rightAttrsDiff, child.unmounts.attrs, child.node);
  mountNodeStyle(rightStyleDiff, child.unmounts.style, child.node);
  mountNodeEvents(rightEventsDiff, child.unmounts.events, child.node);

  if (child.vnode.innerHTML !== vnode.innerHTML) {
    child.vnode.innerHTML = vnode.innerHTML;
    child.node.innerHTML = vnode.innerHTML;
  }

  const control = child.control;
  const prevs = child.vnode.children;
  const latests = getSafeVNodes(vnode.children);

  // then recursively remount vnode children
  // this a depth first traversal algorithm
  // which I am thinking could be a breadth
  // first traversal but this is not a search
  // so the end time should be the same
  remountVNodes(
    control.spaces,
    prevs,
    latests,
    control.cancellations,
    control.insert,
    control.remove,
    control.move
  );
};

const mountChildStream = (stream, _insert, _remove, _move) => {
  let mounted = false;
  let prevs = [];
  const cancel = CancelInterceptor.join(empty());
  const spaces = new Map();
  const cancellations = new Map(); // stream cancellation Map

  const get = (space, position) =>
    spaces.has(space) ? spaces.get(space).get(position) : null;

  const getExternalPosition = (space, position) => {
    let _position = position + (space !== 0 ? 1 : 0);
    spaces.forEach((positions, spaceKey) => {
      if (spaceKey >= space) return;
      // find the largest position key and if spaceKey is not 0 then add 1 for offset
      const offset = spaceKey !== 0 ? 1 : 0;
      const largest =
        positions.size === 0 ? 0 : getLargestPositionKey(positions);
      _position += largest + offset;
    });
    return _position;
  };

  const move = (space, position, length) => {
    if (!spaces.has(space) || !get(space, position)) return;
    const positions = spaces.get(space);
    const positionsPlaceholder = new Map();

    // position adjustment on existing child
    positions.forEach((child, positionKey) => {
      const _pos = position > positionKey ? positionKey : positionKey + length;
      positionsPlaceholder.set(_pos, child);
    });
    positions.clear();

    positionsPlaceholder.forEach((child, positionKey) =>
      positions.set(positionKey, child)
    );
    positionsPlaceholder.clear();
  };

  const insert = (child, space, position) => {
    if (!spaces.has(space)) spaces.set(space, new Map()); // create a space if doesn't exists yet

    if (get(space, position)) {
      _move(getExternalPosition(space, position), 1); // move external position
      move(space, position, 1);
    } else {
      // check if has a head space for adjustment ot position
      const headSpaceKey = getHeadSpaceKey(spaces, space);
      if (headSpaceKey !== null && spaces.get(headSpaceKey).size !== 0) {
        // if the position of a space is larger than the current largest
        // the move by their difference
        const positions = spaces.get(space);
        const smallestPositionKey = getSmallestPositionKey(
          spaces.get(headSpaceKey)
        );
        if (positions.size) {
          const largest = getLargestPositionKey(positions);
          if (position > largest) {
            const diff = position - largest;
            _move(getExternalPosition(headSpaceKey, smallestPositionKey), diff);
          }
        }
      }
    }

    _insert(child, getExternalPosition(space, position));
    spaces.get(space).set(position, child);
  };

  const remove = (space, position) => {
    if (!get(space, position)) return;

    const externalPosition = getExternalPosition(space, position);
    _remove(externalPosition);
    spaces.get(space).set(position, null);
  };

  const unmount = () => {
    cancel.run();
    cancellations.forEach(cancel => cancel());
    spaces.forEach((space, spaceKey) =>
      space.forEach((_, positionKey) => remove(spaceKey, positionKey))
    );
    cancellations.clear();
    spaces.clear();
  };

  const next = vnodes => {
    const latests = vnodes;

    // mount and remounting
    if (mounted)
      remountVNodes(
        spaces,
        prevs,
        latests,
        cancellations,
        insert,
        remove,
        move
      );
    else
      mountVNodes(
        latests.map((vnode, index) => ({ vnode, index })),
        cancellations,
        insert,
        remove,
        move
      );

    mounted = true;
    prevs = latests;
  };

  const fail = error => {
    throw new Error(error);
  };

  // listen to the stream node
  pipe(stream, map(getSafeVNodes), listen({ next, fail }, cancel));

  return unmount;
};

// helpers for creating virtual nodes
export const ref = () => new Ref();
export const e = (...args) =>
  args.length === 2
    ? new VElement(args[0], {}, args[1])
    : new VElement(...args);
export const t = (text, ref) => new VText(text, ref);
export const fromRef = ref => pipe(ref.subject);
export const fromEventRef = (ref, event) =>
  pipe(
    fromRef(ref),
    switchMap(([node, ins]) => (ins ? fromEvent(node, event) : empty()))
  );

// primary mount function
export const mount = (parent, vnodes) => {
  const spaces = new Map(); // space index map
  const cancellations = new Map(); // cancellation for child stream

  const get = (space, position) =>
    spaces.has(space) ? spaces.get(space).get(position) : null;

  const move = (space, position, length) => {
    if (!spaces.has(space) || !get(space, position)) return;
    const positions = spaces.get(space);
    const positionsPlaceholder = new Map();

    // position adjustment on existing child
    positions.forEach((child, positionKey) => {
      const _pos = position > positionKey ? positionKey : positionKey + length;
      positionsPlaceholder.set(_pos, child);
    });
    positions.clear();

    positionsPlaceholder.forEach((child, positionKey) =>
      positions.set(positionKey, child)
    );
    positionsPlaceholder.clear();
  };

  const insert = (child, space, position) => {
    if (!spaces.has(space)) spaces.set(space, new Map()); // create a space if doesn't exists yet

    // if space and position exists then move all the succeeding to right by 1
    if (get(space, position)) move(space, position, 1);

    // recursive check of space
    let headSpaceKey = space;
    let headPositionKey = null;
    let _position = position;
    while (headSpaceKey !== null) {
      headPositionKey = getHeadPositionKey(spaces.get(headSpaceKey), _position);
      if (headPositionKey !== null) break;
      headSpaceKey = getHeadSpaceKey(spaces, headSpaceKey);
      _position = -1;
    }

    // acquire the head node
    const head =
      headSpaceKey !== null && headPositionKey !== null
        ? spaces.get(headSpaceKey).get(headPositionKey)
        : null;

    spaces.get(space).set(position, child);
    parent.insertBefore(child.node, head && head.node);
    if (child.vnode.ref) {
      child.vnode.ref.control.open();
      child.vnode.ref.control.next([child.node, true]);
    }

    return child;
  };

  const remove = (space, position) => {
    const child = get(space, position);

    if (!child) return;
    if (child.vnode instanceof VElement)
      unmountNodeProps(child.vnode, child.unmounts, child.node);

    spaces.get(space).set(position, null);
    parent.removeChild(child.node);
    if (child.vnode.ref) {
      child.vnode.ref.control.next([child.node, false]);
      child.vnode.ref.control.done();
    }
  };

  const unmount = () => {
    cancellations.forEach(cancel => cancel());
    spaces.forEach((space, spaceKey) =>
      space.forEach((_, positionKey) => remove(spaceKey, positionKey))
    );
    cancellations.clear();
    spaces.clear();
  };

  mountVNodes(
    getSafeVNodes(vnodes).map((vnode, index) => ({ vnode, index })),
    cancellations,
    insert,
    remove,
    move
  );

  return { get, insert, remove, unmount, cancellations, spaces };
};
