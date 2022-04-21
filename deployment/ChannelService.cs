using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using k8s;
using k8s.Models;
using Microsoft.Extensions.Logging;

namespace KubeClient
{
    public class ChannelService : IChannelService
    {
        const string DefaultNamespace = "default";

        private readonly Kubernetes _client;
        private readonly ILogger<ChannelService> _logger;

        public ChannelService(ILogger<ChannelService> logger)
        {
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            var config = KubernetesClientConfiguration.InClusterConfig();
            _client = new Kubernetes(config);
        }

        public async Task CreateChannelAsync(string name, string rtmp_source)
        {
            bool isGpu = name.StartsWith("gpu");
            var srt = name.StartsWith("wrtc");
            var tolerations = new List<V1Toleration>
            {
                new V1Toleration
                {
                    Key = "type",
                    Value = "backend",
                    OperatorProperty = "Equal",
                    Effect = "NoSchedule"
                }
            };
            if (isGpu)
            {
                tolerations.Add(new V1Toleration
                {
                    Key = "sku",
                    Value = "gpu",
                    OperatorProperty = "Equal",
                    Effect = "NoSchedule"
                });
            }

            var limits = new Dictionary<string, ResourceQuantity>
            {
                { "memory", new ResourceQuantity("8Gi") }
            };
            if (isGpu)
            {
                limits.Add("cpu", new ResourceQuantity("2"));
                limits.Add("nvidia.com/gpu", new ResourceQuantity("1"));
            }
            else 
            {
                limits.Add("cpu", new ResourceQuantity("3.8"));
            }

            var deployment = new V1Deployment
            {
                ApiVersion = "apps/v1",
                Kind = "Deployment",
                Metadata = new V1ObjectMeta
                {
                    Name = name,
                    NamespaceProperty = null,
                    Labels = new Dictionary<string, string>
                    {
                        { "app", $"{name}-deployment" },
                        { "service", name }
                    }
                },
                Spec = new V1DeploymentSpec
                {
                    Replicas = 1,
                    Selector = new V1LabelSelector
                    {
                        MatchLabels = new Dictionary<string, string>
                        {
                            { "service", name }
                        }
                    },
                    Template = new V1PodTemplateSpec
                    {
                        Metadata = new V1ObjectMeta
                        {
                            CreationTimestamp = null,
                            Labels = new Dictionary<string, string>
                            {
                                { "app", $"{name}-deployment" },
                                { "service", name }
                            }
                        },
                        Spec = new V1PodSpec
                        {
                            Tolerations = tolerations,
                            NodeSelector = new Dictionary<string, string>
                            {
                                { "type", "backend" }
                            },
                            Containers = new List<V1Container>
                            {
                                new V1Container
                                {
                                    Name = "ffmpeg",
                                    Image = "livestream.azurecr.io/ffmpeg",
                                    ImagePullPolicy = "IfNotPresent",
                                    Ports = new List<V1ContainerPort>
                                    {
                                        new V1ContainerPort(80) 
                                    },
                                    Resources = new V1ResourceRequirements
                                    {
                                        Limits = limits
                                    },
                                    Command = new[] { "node" },
                                    Args = new[] 
                                    {
                                        "index.js",
                                        "-i",
                                        $"rtmp://{rtmp_source}/live/{name}",
                                        "--gpu",
                                        isGpu.ToString().ToLower()
                                    }
                                }
                            }
                        }
                    }
                },
                Status = new V1DeploymentStatus
                {
                    Replicas = 1
                }
            };

            var service = new V1Service
            {
                ApiVersion = "v1",
                Kind = "Service",
                Metadata = new V1ObjectMeta
                {
                    Name = name,
                    Labels = new Dictionary<string,string>
                    {
                        { "service", name },
                        { "app", $"{name}-deployment" }
                    }
                },
                Spec = new V1ServiceSpec
                {
                    Ports = new List<V1ServicePort>
                    { 
                        new V1ServicePort(80)
                    },
                    Selector = new Dictionary<string, string>
                    {
                        { "service", name }
                    }
                },
            };
            try
            {
                // delete any old deployments.
                await _client.DeleteNamespacedDeploymentAsync(name, DefaultNamespace);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to cleanup existing deployment");
            }
            try
            {
                var result = await _client.CreateNamespacedDeploymentAsync(deployment, DefaultNamespace);
                _logger.LogInformation("Created deployment {0} result:{1}", name, result);
                var serviceResult = await _client.CreateNamespacedServiceAsync(service, DefaultNamespace);
                _logger.LogInformation("Created service {0}={1}", name, serviceResult);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to create deployment");
                throw;
            }
        }
        public async Task DeleteChannelAsync(string name)
        {
            try
            {
                // delete any old deployments.
                await _client.DeleteNamespacedDeploymentAsync(name, DefaultNamespace);
                await _client.DeleteNamespacedServiceAsync(name, DefaultNamespace);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to cleanup existing deployment");
            }
        }
    }
}
