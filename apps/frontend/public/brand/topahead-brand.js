(function brandPostizAsTopAhead() {
  document.documentElement.setAttribute('data-brand', 'topahead');
  if (document.title && /postiz/i.test(document.title)) {
    document.title = document.title.replace(/postiz/gi, 'TopAhead');
  }

  const replaceLoginHero = () => {
    const nodes = Array.from(document.querySelectorAll('div'));
    const hero = nodes.find((node) =>
      (node.textContent || '').includes('Entrepreneurs use')
    );
    if (!hero || hero.dataset.taBranded === '1') {
      return;
    }
    hero.dataset.taBranded = '1';
    hero.classList.add('ta-login-hero');
    hero.innerHTML =
      '<h2>TopAhead social desk</h2>' +
      '<p>Schedule once across brands. Keep every channel on-model for <strong>TopAhead</strong>.</p>';
  };

  replaceLoginHero();
  const observer = new MutationObserver(replaceLoginHero);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
