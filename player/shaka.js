async function load(url) {
    try {
        await player.load(url);
    } catch(err) {
        console.log(err);
        throw err;
    }
    console.log("playback started ...");
}

async function joinLive() {
    const url = getPlaybackUrl(false);
    await load(url);
}

function initializeShakaPlayer(video) {
    // Get the player instance from the UI.
    const ui = video['ui'];
    const controls = ui.getControls();
    const player = controls.getPlayer();
    player.configure({
      manifest: {
          dash: {
             // autoCorrectDrift: true
          }
      },
      streaming: {
        lowLatencyMode: true,
        useNativeHlsOnSafari: true,
      },
    });
    player.setTextTrackVisibility(true);

    window.player = player; // for debugging.
    player.addEventListener('error', event => {
        console.log(`error playing ${event.detail}`);
    });    
}

function getPlaybackUrl() {
    return baseurl = document.getElementById('url').value;
}

function initialize() {
    var video = document.getElementById('camera');
    window.video = video;
    initializeShakaPlayer(video);
    document.getElementById('play').addEventListener('click', () => {
        joinLive();        
    })
}

// shaka.log.setLevel(shaka.log.Level.DEBUG);
shaka.polyfill.installAll();
 
//Initialize.
document.addEventListener('shaka-ui-loaded', initialize);
