using System.Threading.Tasks;

namespace KubeClient
{
    public interface IChannelService
    {
        Task CreateChannelAsync(string name, string rtmp_source);

        Task DeleteChannelAsync(string name);
    }
}
