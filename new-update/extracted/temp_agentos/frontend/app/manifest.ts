import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AgentOS',
    short_name: 'AgentOS',
    description: 'Give AI a goal. AgentOS researches the web and returns a verified answer with sources.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0d12',
    theme_color: '#0a0d12',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  };
}