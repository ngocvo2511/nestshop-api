const { resolve, sep } = require('node:path');
module.exports = (request, options) => {
  const root = resolve(__dirname, '../..');
  // Only our test-to-dist imports are remapped. Dependencies may have their own ../dist.
  if (
    options.basedir.startsWith(resolve(root, 'test') + sep) ||
    options.basedir === resolve(root, 'test')
  ) {
    const match = /^\.\.\/(?:\.\.\/)?dist\/(.+)$/.exec(request);
    if (match)
      return options.defaultResolver(resolve(root, 'src', match[1]), options);
  }
  return options.defaultResolver(request, options);
};
