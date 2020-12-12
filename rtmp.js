const NodeMediaServer = require('node-media-server');

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
	/*
    ssl: {
      port: 443,
      key: './privatekey.pem',
      cert: './certificate.pem',
    }
	*/
  }
};

var nms = new NodeMediaServer(config);
nms.run();