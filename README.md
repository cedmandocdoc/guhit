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
import { mount, createState, e } from "./src";

const TextCount = count$ => {
  // return a transformed id (id-{count})
  // manipulate the <p id="">
  const countId = pipe(
    count$,
    map(c => `id-${c}`)
  );

  const currentCount = pipe(
    count$,
    map(c => {
      if (c % 2 === 0) return "Cannot display even number";
      return c;
    })
  );

  // return a <p> with id and text count changing
  return e("p", { id: countId }, {}, ["Current count: ", currentCount]);
};

const App = () => {
  // Since observable is directly manipulating the DOM
  // there is no re rendering happenning inside the App.
  // Running setCount will not rerender the App but will
  // directly manipulate the <p> on TextCount.

  // here count is an observable that gets
  // subscribed on TextCount to change its values
  const count$ = create((open, next, fail, done) => {
    let count = 0;
    const id = setInterval(() => next(++count), 100);
    open();
  })

  // return a div with text count
  return e("div", {}, {}, ["Hello There", TextCount(count$)]);
};

mount(document.getElementById("app"), App());
```
