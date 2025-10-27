// src/client/core.js
var Core = class {
  constructor() {
    this.queryResolves = [];
  }
  onopen() {
  }
  onmessage(e) {
    this.queryResolves.shift()(e.data);
  }
  report(path, value) {
    this.ws.send(JSON.stringify({ cmd: "report", path, value }));
  }
  query(path, start, end, agg) {
    this.ws.send(JSON.stringify({ cmd: "query", path, start, end, agg }));
    let promise = new Promise((resolve) => {
      this.queryResolves.push(resolve);
    });
    return promise;
  }
};

// src/client/eggtrixWeb.js
var Eggtrix = class extends Core {
  constructor(url) {
    super();
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.onopen();
    this.ws.onmessage = (e) => this.onmessage(e);
  }
};
export {
  Eggtrix
};
