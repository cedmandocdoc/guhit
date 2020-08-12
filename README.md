# Guhit

A reactive JavaScript library for building web user interfaces

## Installation

Install it using npm or yarn.

```bash
npm install agos guhit
```

## Example

```javascript
import { pipe, map } from "agos";
import { mount, createState, h } from "./src";

const TextCount = count => {
  // return a transformed id (id-{count})
  // manipulate the <p id="">
  const countId = pipe(
    count,
    map(c => `id-${c}`)
  );

  const currentCount = pipe(
    count,
    map(c => {
      if (c % 2 === 0) return "Cannot display even number";
      return c;
    })
  );

  // return a <p> with id and text count changing
  return h("p", { id: countId }, ["Current count: ", currentCount]);
};

const App = () => {
  // Since observable is directly manipulating the DOM
  // there is no re rendering happenning inside the App.
  // Running setCount will not rerender the App but will
  // directly manipulate the <p> on TextCount.

  // here count is an observable that gets
  // subscribed on TextCount to change its values
  const [count, setCount] = createState(0);

  const onMount = () => {
    const id = setInterval(() => {
      setCount(count => ++count);
    }, 1000);

    return () => clearInterval(id);
  };

  // return a div with text count
  return h("div", {}, ["Hello There", TextCount(count)], onMount);
};

mount(App(), document.getElementById("app"));
```
