// URL de la Web App Apps Script.
// NE PAS la committer ici : elle est stockée dans le secret GitHub BJ_API_URL et
// injectée au déploiement par .github/workflows/pages.yml (scripts/injecter-config.sh).
// En local, remplacez-la temporairement sans committer.
window.BJ_CONFIG = Object.freeze({
  API_URL: 'https://script.google.com/macros/s/AKfycbxtUMtWel84YjHDS0dwEgEsht90u_YTEIBF0VZ7xiNKMvmmlDrNQrt1sK4aZZ7F6-Bp/exec',
  INTERVALLE_MS: 2500
});
