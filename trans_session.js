const EventEmitter = require('events');
const { spawn } = require('child_process');
const dateFormat = require('dateformat');
const mkdirp = require('mkdirp');
const fs = require('fs');

class TransSession extends EventEmitter {
  constructor(conf) {
    super();
    this.conf = conf;
  }

  run(sdpString) {
    let vc = this.conf.vc || 'copy';
    let ac = this.conf.ac || 'copy';

    let ouPath = `${this.conf.mediaRoot}/${this.conf.streamApp}/${this.conf.streamName}`;
    let mapStr = '';

    if (this.conf.rtmp && this.conf.rtmpAddress) {
        mapStr += `[f=flv]${this.conf.rtmpAddress}|`;
        console.log('[Transmuxing RTMP] ' + this.conf.rtmpAddress);
    }

    if (this.conf.mp4) {
      this.conf.mp4Flags = this.conf.mp4Flags ? this.conf.mp4Flags : '';
      let mp4FileName = dateFormat('yyyy-mm-dd') + '.mp4';
      let mapMp4 = `${this.conf.mp4Flags}${ouPath}/${mp4FileName}|`;
      mapStr += mapMp4;
      console.log('[Transmuxing MP4] ' + ouPath + '/' + mp4FileName);
    }

    if (this.conf.hls) {
      this.conf.hlsFlags = this.conf.hlsFlags ? this.conf.hlsFlags : '';
      let hlsFileName = 'index.m3u8';
      let mapHls = `${this.conf.hlsFlags}${ouPath}/${hlsFileName}|`;
      mapStr += mapHls;
      console.log('[Transmuxing HLS] ' + ouPath + '/' + hlsFileName);
    }

    if (this.conf.dash) {
      this.conf.dashFlags = this.conf.dashFlags ? this.conf.dashFlags : '';
      let dashFileName = 'index.mpd';
      let mapDash = `${this.conf.dashFlags}${ouPath}/${dashFileName}`;
      mapStr += mapDash;
      console.log('[Transmuxing DASH] ' + ouPath + '/' + dashFileName);
    }

    mkdirp.sync(ouPath);

    let argv = [
        '-protocol_whitelist', 'pipe,rtp,udp',
        '-i', '-',
        // "-reorder_queue_size", "0"
    ];

    Array.prototype.push.apply(argv, ['-c:v', vc]);
    Array.prototype.push.apply(argv, this.conf.vcParam);
    Array.prototype.push.apply(argv, ['-c:a', ac]);
    Array.prototype.push.apply(argv, this.conf.acParam);
    Array.prototype.push.apply(argv, ['-f', 'tee', '-map', '0:a?', '-map', '0:v?', mapStr]);
    
    argv = argv.filter((n) => { return n; });
    this.ffmpeg_exec = spawn(this.conf.ffmpeg, argv);

    // Feed SDP into FFMpeg sdtin
    this.ffmpeg_exec.stdin.write(sdpString);
    this.ffmpeg_exec.stdin.end();
    this.ffmpeg_exec.stdout.pipe(process.stdout);
    this.ffmpeg_exec.stderr.pipe(process.stderr);

    this.ffmpeg_exec.on('error', (e) => {
      console.log(e);
    });

    this.ffmpeg_exec.stdout.on('data', (data) => {
      console.log(`${data}`);
    });

    this.ffmpeg_exec.stderr.on('data', (chunk) => {
        console.log(`${chunk}`);
        chunk
        .toString()
        .split(/\r?\n/g)
        .forEach((line) => {
            if (line.indexOf('ffmpeg version') !== -1) {
                this.emit('ffmpeg:start');
            }
        });
    });

    this.ffmpeg_exec.on('exit', (code, signal) => {
        this.emit('ffmpeg:exit', code, signal)
    })

    this.ffmpeg_exec.on('close', (code) => {
      console.log('[Transmuxing end] ');
      this.emit('end');
      fs.readdir(ouPath, function (err, files) {
        if (!err) {
          files.forEach((filename) => {
            if (filename.endsWith('.ts')
              || filename.endsWith('.m3u8')
              || filename.endsWith('.mpd')
              || filename.endsWith('.m4s')
              || filename.endsWith('.tmp')) {
              fs.unlinkSync(ouPath + '/' + filename);
            }
          });
        }
      });
    });
  }

  end() {
    this.ffmpeg_exec.kill();
  }
}

module.exports = TransSession;