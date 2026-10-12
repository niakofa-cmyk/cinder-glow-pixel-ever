/** Record failures without suppressing any: navigation timing explains aborts. */
export function attachNetworkAudit(page, currentCheck = () => null) {
  const failedRequests = [], navigations = [];
  const requests = new WeakMap();
  let generation = 0, activeNavigation = null;
  page.on("request", request => {
    requests.set(request, { startedAt: Date.now(), generation, check: currentCheck() });
  });
  page.on("framenavigated", frame => {
    if (frame === page.mainFrame()) generation++;
  });
  page.on("requestfailed", request => {
    const start = requests.get(request) ?? {};
    failedRequests.push({
      url: request.url(), resourceType: request.resourceType(),
      errorText: request.failure()?.errorText ?? null,
      ...start, failedAt: Date.now(), failureGeneration: generation,
      navigationId: activeNavigation?.id ?? null, check: currentCheck(),
    });
  });
  const reload = page.reload.bind(page);
  page.reload = async (...args) => {
    const navigation = { id: navigations.length + 1, kind: "reload", check: currentCheck(), startedAt: Date.now() };
    navigations.push(navigation);
    activeNavigation = navigation;
    try { return await reload(...args); }
    finally { navigation.finishedAt = Date.now(); activeNavigation = null; }
  };
  return { failedRequests, navigations };
}
