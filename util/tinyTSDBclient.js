// src/tinyTSDBshared.mjs
var Scale = {
  Second: 1e3,
  Minute: 6e4,
  Hour: 36e5,
  Day: 864e5,
  Week: 6048e5,
  Month: 2592e6,
  Year: 31536e6
};
var Aggregator = {
  Sum: 1,
  Min: 2,
  Max: 4,
  First: 8,
  Last: 16
};

// src/tinyTSDBclient.mjs
var TinyTSDBclient = class {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.requests = [];
    this.sendQueue = [];
  }
  get(key, start, end, aggregator) {
    this._send(JSON.stringify({ cmd: "get", key, start, end, aggregator }));
    return new Promise((resolve, reject2) => {
      this.requests.push({ resolve, reject: reject2 });
    });
  }
  getLatest(key, aggregator) {
    this._send(JSON.stringify({ cmd: "getLatest", key, aggregator }));
    return new Promise((resolve, reject2) => {
      this.requests.push({ resolve, reject: reject2 });
    });
  }
  getAllTime(key, aggregator) {
    this._send(JSON.stringify({ cmd: "getAllTime", key, aggregator }));
    return new Promise((resolve, reject2) => {
      this.requests.push({ resolve, reject: reject2 });
    });
  }
  _send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      if (!this.ws || this.ws.readyState !== WebSocket.CONNECTING) {
        try {
          this.ws = new WebSocket(this.url);
        } catch (e) {
          reject(e);
        }
        this.ws.onopen = () => {
          for (let q of this.sendQueue) {
            this.ws.send(q);
          }
          this.sendQueue = [];
        };
        this.ws.onmessage = (e) => this._onmessage(e.data);
      }
      this.sendQueue.push(data);
    }
  }
  _onmessage(data) {
    data = JSON.parse(data.toString());
    switch (data.cmd) {
      case "get":
      case "getLatest":
      case "getAllTime":
        let res = this.requests.shift();
        if (data.datas.error) {
          res.reject(data.datas.error);
        } else {
          res.resolve(data.datas);
        }
        break;
      default:
        console.log("Unknown command", data);
    }
  }
};
export {
  Aggregator,
  Scale,
  TinyTSDBclient
};
