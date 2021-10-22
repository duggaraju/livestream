import ffmpeg from 'fluent-ffmpeg'
import ffmpegpath from 'ffmpeg-static';
import fs from 'fs';
import BufferList from 'bl';
import EventEmitter from 'events';
import yargs from 'yargs';
/// required modules
import { ServerResponse, IncomingMessage, createServer } from 'http';

var argv = yargs(process.argv.slice(2))
  .option('gpu', {
    alias: 'g',
    default: false,
    description: 'gpu to use',
    type: 'boolean',
    demandOption: false
  })
  .help()
  .alias('help', 'h')
  .parseSync();
console.log(argv);


const media_root = process.env['MEDIA_ROOT'] || (process.platform === 'win32' ? '\\media' : '/media');
const rtmp_source = process.env['RTMP_SOURCE'] || '127.0.0.1'
const stream_key = process.env['STREAM_KEY'] || 'test'
const port = 80;
const gpu = argv.gpu;

declare interface CacheEleme {
  on(event: 'end', listener: () => void): this;
  on(event: 'data', listener: (chunk: any) => void): this;
}

if (!fs.existsSync(media_root)) {
  console.log(`creating directory ${media_root}`);
  fs.mkdirSync(media_root, { recursive: true });
}

console.info(`ffmpeg path is ${ffmpegpath}`);
//ffmpeg.setFfmpegPath(ffmpegpath);  
const url = `rtmp://${rtmp_source}/live/${stream_key}`;
const command = ffmpeg({
  logger: console
});

const resolutions = [
  {
    resolution: '640x360',
    bitrate: '500K'
  },
  {
    resolution: '960x540',
    bitrate: '1500K'

  },
  {
    resolution: '1280x760',
    bitrate: '2500K'
  }
]

const videoOptions = resolutions.flatMap((res, index) => {
  return [
    '-map',
    '0:v:0',
    `-b:v:${index}`,
    res.bitrate,
    `-s:v:${index}`,
    res.resolution
  ];
})

function getX264Options(): string[] {
  const options = ['-tune', 'zerolatency'];
  const videoOptions = resolutions.flatMap((res, index) => {
    return [
      '-map',
      '0:v:0',
      `-c:v:${index}`, 'libx264',
      `-b:v:${index}`, res.bitrate,
      `-s:v:${index}`, res.resolution
    ];
  });
  return options.concat(videoOptions);
}

function getNvencOptions(): string[] {

  const options = ['-tune', 'zerolatency'];
  const videoOptions = resolutions.flatMap((res, index) => {
    return [
      '-map',
      '0:v:0',
      `-c:v:${index}`, 'h264_nvenc',
      `-b:v:${index}`,
      res.bitrate,
      `-vf:${index}`,
      `scale_npp=${res.resolution.replace('x', ':')}`
    ];
  });
  return options.concat(videoOptions);
}

function getNvencInputOptions(): string[] {
 return [
    '-hwaccel',  'cuda',
    '-hwaccel_output_format', 'cuda'
  ];
}

const videoStreams = Array.from(Array(resolutions.length).keys()).join();
const audioStream = resolutions.length;
command
  .input(url)
  //.inputOptions([ '-report' ])
  .inputOption(gpu ? getNvencInputOptions() : [])
  .audioCodec('aac')
  .audioBitrate('64k')
  .output(`http://localhost:${port}/ingest/dash.mpd`)
  .outputOption(gpu ? getNvencOptions() : getX264Options())
  .outputOption(
    '-map', '0:a',
    '-g', '30',
    '-keyint_min', '30',
    '-sc_threshold', '0',
    '-use_timeline', '0',
    '-utc_timing_url', 'http://time.akamai.com',
    '-format_options', 'movflags=cmaf',
    '-frag_type', 'duration',
    //    '-seg_duration', '4',
    '-frag_duration', '1',
    '-ldash', '1',
    //    '-lhls 1',
    '-streaming', '1',
    '-window_size', '30',
    '-target_latency', '1',
    '-export_side_data', 'prft',
    '-write_prft', '1',
    '-extra_window_size', '35',
    '-hls_playlist', '1',
    '-hls_master_name', 'hls.m3u8',
    '-adaptation_sets', `id=0,seg_duration=2,frag_duration=1,streams=${videoStreams} id=1,seg_duration=2,frag_type=none,streams=${audioStream}`,
  );

console.log(`running ${command}`);
command.on('start', (c) => {
  console.log(`Running command: ${c}`);
})

command.on('error', (err, stdout, stderr) => {
  console.log('On error', err, stdout, stderr);
  console.warn('Retrying the command again');
  setTimeout(() => {
    console.log('retrying the command after 100 ms.');
    command.run();
  }, 100);
})
command.run();

/// data object for caching ingest data
/// Writes all incoming data to storage and keeps
/// a copy in memory for live serving until the
/// file is completely received and written.
declare interface CacheEleme {
  on(event: 'end', listener: () => void): this;
  on(event: 'data', listener: (chunk: any) => void): this;
}
class CacheElem extends EventEmitter {
  public ended: boolean;
  public buffer_list: BufferList;
  public res: ServerResponse[];
  constructor() {
    super();
    this.buffer_list = new BufferList;
    this.res = [];
    this.ended = false;
  }
}


/// globals
const data_root = media_root;                /// root directory for all data
const server_port_ingest = 80;       /// server listening port for ingest
const stream_cache = new Map<string, CacheElem>(); /// global data cache for incoming ingests

/// checks GET or POST request URLs for sanity to avoid spammers & crashes
function check_sanity(url: string) {
  return url.startsWith('/ingest/') || url.startsWith('/')
}

/// sends the no such file response (http 404)
function send_404(res: ServerResponse) {
  res.statusCode = 404;
  res.statusMessage = "Not found";
  res.end();
}

/// sends the internal server error response (http 500)
function send_500(res: ServerResponse) {
  res.statusCode = 500;
  res.statusMessage = "Internal error";
  res.end();
}

/// sends a complete file of known length from storage as a single response
/// @param  res             HttpResponse to write the data into
/// @param  content_type    String to write for the content type of the response
/// @param  filename        The file containing the data to be send
function send_fixed_length(res: ServerResponse, content_type: string, filename: string) {
  fs.readFile(filename, (err, data) => {
    if (err) {
      send_404(res);
      throw err;
    } else {
      res.writeHead(200, {
        'Content-Length': Buffer.byteLength(data),
        'Content-Type': content_type,
        'Access-Control-Allow-Origin': '*'
      });
      res.write(data);
      res.end();
    }
  });
}

/// sends a complete file from storage as a chunked response
/// @param  res             HttpResponse to write the data into
/// @param  content_type    String to write for the content type of the response
/// @param  filename        The file containing the data to be send
function send_chunked(res: ServerResponse, content_type: string, filename: string) {
  var stream = fs.createReadStream(filename);

  stream.on('error', (err) => {
    console.log(`404 bad file ${filename}`);

    send_404(res);
  });

  stream.once('readable', () => {
    // implicitly set to chunked encoding if pipe'd to res, needs to be set for res.write()
    // also set content-type correctly (even if pipe'd)
    res.writeHead(200, {
      'Content-Type': content_type,
      'Transfer-Encoding': 'chunked',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*'
    });
    stream.pipe(res);
  });
}

/// sends a complete file from cache (if found) or storage (fallback) as a chunked response
/// @param  res             HttpResponse to write the data into
/// @param  content_type    String to write for the content type of the response
/// @param  filename        The file containing the data to be send
function send_chunked_cached(res: ServerResponse, content_type: string, filename: string) {
  if (stream_cache.has(filename)) {
    const cache_elem = stream_cache.get(filename)!;
    console.log('=== Chunked transfer encoding ', filename, " ===");
    res.writeHead(200, {
      'Content-Type': content_type,
      'Transfer-Encoding': 'chunked',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*'
    });

    const current = cache_elem.buffer_list.slice();
    res.write(current);

    if (cache_elem.ended) {
      res.end();
    } else {
      cache_elem.res.push(res);
      cache_elem.on('data', (chunk: any) => {
        //console.log(`data event for ${filename}`);
        res.write(chunk);
      });
    }
  } else {
    send_chunked(res, content_type, filename);
  }
}

/// create server and define handling of supported requests
function request_listener(req: IncomingMessage, res: ServerResponse) {
  const url = req.url!;
  if (req.httpVersion != '1.1') {
    console.log(`Warning! Ignoring non-HTTP/1.1 ${req.httpVersion} ${req.method} request of URL: ${req.url}`);
    //console.log('=====', 'Headers:', req.headers, '=====');
  }
  if (!check_sanity(url)) {
    console.log(`ReJECT ${req.method} ${req.url}`);
  } else if (req.method == 'GET') {
    const suffix_idx = url.lastIndexOf('.');
    const suffix = url.slice(suffix_idx, url.length);
    var filename = data_root + req.url;

    console.log(`GET ${req.url}`);
    switch (suffix) {
      case '.m3u8':
        send_chunked(res, 'application/x-mpegURL', filename);
        break;
      case '.mpd':
        send_chunked(res, 'application/dash+xml', filename);
        break;
      case '.m4s':
        send_chunked_cached(res, 'video/mp4', filename);
        break;
      default:
        console.log(`404 bad suffix ${suffix}`);
        send_404(res);
        break;
    }
  } else if (req.method == 'POST') { // check for POST method, ignore others
    const prefix = '/ingest';
    const suffix = url.slice(prefix.length, url.length);
    const filename = data_root + suffix;

    console.log(`POST ${req.url}`);

    const file_stream = fs.createWriteStream(filename);
    const file_cache = new CacheElem();

    file_stream.on('error', (err) => {
      send_500(res);
      throw err;
    });

    stream_cache.set(filename, file_cache);
    file_cache.on('end', function () {
      file_cache.ended = true;
      const l = file_cache.res.length;
      for (var i = 0; i < l; i++) {
        file_cache.res[0].end(); // end transmission on first response
        file_cache.res.shift();  // delete response from array
      }
      stream_cache.delete(filename);
    });


    req.on('data', (chunk: any) => {
      const cache = stream_cache.get(filename)!;
      cache.buffer_list.append(chunk);
      cache.emit('data', chunk);
      file_stream.write(chunk);
    });
    //req.on('close', () => { // not every stream emits 'close', so rely on 'end' event
    //});
    req.on('end', () => {
      file_cache.emit('end');
      file_stream.end();
    });
  } else if (req.method == 'DELETE') { // check for DELETE method
    const prefix = '/ingest';
    const suffix = url.slice(prefix.length, url.length);
    const filename = data_root + suffix;
    console.log(`DELETE ${req.url}`);

    fs.unlink(filename, (err) => {
      if (err) throw err;
    });
  } else if (req.method === 'OPTIONS') {
    console.log(`OPTIONS ${req.url}`);
    console.log('=====', 'Headers:', req.headers, '=====');
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
    res.end();
  } else {
    console.log(`Unhandled request method ${req.method}.`)
  }
}

// create the servers
const server_ingest = createServer(request_listener);
server_ingest.listen(server_port_ingest);

// ready to receive ingests and client requests
console.log(`Listening for ingest on port:   ${server_port_ingest}`);

process.on('SIGTERM', () => {
  console.info('Got SIGTERM. Graceful shutdown start', new Date().toISOString())
  // start graceul shutdown here
  command.removeAllListeners('error');
  command.kill('SIGTERM');
  server_ingest.close((err) => {
    console.log('shutdown the server', err);
    process.exit();
  })
})