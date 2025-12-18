// network/petfeedDiscovery.js
// Responsible for discovering PetFeed devices on the local network via mDNS

let discoveryInterval = null;

export function startPetfeedDiscovery(onUpdate) {
  if (discoveryInterval) return;

  discoveryInterval = setInterval(async () => {
    try {
      // iOS does not allow enumerating mDNS services directly.
      // We probe a bounded set of likely PetFeed hostnames instead.
      const candidates = [];

      for (let i = 0; i < 20; i++) {
        candidates.push(`petfeeder-${i}.local`);
      }

      const found = [];

      for (const host of candidates) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 1500);

          const res = await fetch(`http://${host}/ping`, {
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (res.ok) {
            found.push({
              id: host,
              name: host.replace(".local", ""),
              host,
              online: true,
              connection: "Local device",
            });
          }
        } catch {
          // not reachable
        }
      }

      if (found.length > 0) {
        onUpdate(found);
      }
    } catch (e) {
      console.log("PetFeed discovery error", e);
    }
  }, 5000);
}

export function stopPetfeedDiscovery() {
  if (discoveryInterval) {
    clearInterval(discoveryInterval);
    discoveryInterval = null;
  }
}