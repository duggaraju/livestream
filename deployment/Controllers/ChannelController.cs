using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.Net;
using System.Threading.Tasks;

namespace KubeClient.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class ChannelController : ControllerBase
    {
        private readonly ILogger<ChannelController> _logger;
        private readonly IChannelService _channelService;

        public ChannelController(ILogger<ChannelController> logger, IChannelService channelService)
        {
            _logger = logger;
            _channelService = channelService ?? throw new ArgumentNullException(nameof(channelService));
        }

        [HttpPost("connect")]
        [Consumes("application/x-www-form-urlencoded")]
        public IActionResult OnConnect([FromForm] Dictionary<string, string> values)
        {
            var rtmp_source = HttpContext.Connection.RemoteIpAddress?.MapToIPv4().ToString();
            _logger.LogInformation("Connection received from {0} ",rtmp_source);
            _logger.LogInformation("Received Values {0}", string.Join(',', values));
            return Ok();
        }

        [HttpPost("publish")]
        [Consumes("application/x-www-form-urlencoded")]
        public async Task<IActionResult> OnPublish([FromForm] Dictionary<string, string> values)
        {
            var client_ip = HttpContext.Connection.RemoteIpAddress?.MapToIPv4();
            var rtmp_source = client_ip?.ToString();
            _logger.LogInformation("Publish started from {0}", rtmp_source);
            _logger.LogInformation("Received Values {0}", string.Join(',', values));
            await _channelService.CreateChannelAsync(values["name"], rtmp_source);
            return Ok();
        }

        [HttpPost("play")]
        [Consumes("application/x-www-form-urlencoded")]
        public IActionResult OnPlay([FromForm] Dictionary<string, string> values)
        {
            var client_ip = HttpContext.Connection.RemoteIpAddress?.MapToIPv4();
            _logger.LogInformation("Play request from {0}", client_ip);
            _logger.LogInformation("Received Values {0}", string.Join(',', values));
            return Ok();
        }

        [HttpPost("done")]
        [Consumes("application/x-www-form-urlencoded")]
        public async Task<IActionResult> OnDone([FromForm] Dictionary<string, string> values)
        {
            var client_ip = HttpContext.Connection.RemoteIpAddress?.MapToIPv4();
            _logger.LogInformation("Done request from {0}", client_ip);
            _logger.LogInformation("Received Values {0}", string.Join(',', values));
            var client = new Uri(values["tcurl"]);
            if (!client.Host.StartsWith("10."))
            {
                await _channelService.DeleteChannelAsync(values["name"]);
            }
            return Ok();
        }
    }
}
