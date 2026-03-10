/** Preload module that stubs globalThis.fetch to return empty 200 responses. */
globalThis.fetch = async () =>
  new Response(JSON.stringify([]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
