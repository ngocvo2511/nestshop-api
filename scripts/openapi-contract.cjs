const assert = require('node:assert/strict');
// HTTP JSON can come from Node's fetch realm while tests run inside Jest's VM.
// Compare exact JSON values, not JavaScript prototype identity.
const equalJson = (actual, expected, message) =>
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
const routes = {
  'GET /api/v1/health': [],
  'POST /api/v1/auth/register': [],
  'POST /api/v1/auth/login': [],
  'POST /api/v1/auth/refresh': [],
  'POST /api/v1/auth/logout': [],
  'GET /api/v1/users/me': ['CUSTOMER', 'STAFF', 'ADMIN'],
  'PATCH /api/v1/users/me': ['CUSTOMER', 'STAFF', 'ADMIN'],
  'POST /api/v1/users/me/password': ['CUSTOMER', 'STAFF', 'ADMIN'],
  'GET /api/v1/admin/users/roles': ['ADMIN'],
  'PATCH /api/v1/admin/users/{id}/role': ['ADMIN'],
  'GET /api/v1/products': [],
  'GET /api/v1/products/{id}': [],
  'POST /api/v1/products': ['ADMIN'],
  'PATCH /api/v1/products/{id}': ['ADMIN'],
  'GET /api/v1/products/{id}/image': [],
  'POST /api/v1/products/{id}/image': ['ADMIN'],
  'POST /api/v1/products/{id}/stock-adjustments': ['ADMIN'],
  'GET /api/v1/orders': ['CUSTOMER'],
  'POST /api/v1/orders': ['CUSTOMER'],
  'GET /api/v1/orders/{id}': ['CUSTOMER'],
  'GET /api/v1/orders/{id}/history': ['CUSTOMER'],
  'POST /api/v1/orders/{id}/cancel': ['CUSTOMER'],
  'POST /api/v1/orders/{id}/payment-attempts': ['CUSTOMER'],
  'GET /api/v1/staff/orders': ['STAFF', 'ADMIN'],
  'GET /api/v1/staff/orders/{id}': ['STAFF', 'ADMIN'],
  'GET /api/v1/staff/orders/{id}/history': ['STAFF', 'ADMIN'],
  'POST /api/v1/staff/orders/{id}/status': ['STAFF', 'ADMIN'],
  'GET /api/v1/admin/payments': ['ADMIN'],
  'GET /api/v1/admin/payments/{id}': ['ADMIN'],
  'GET /api/v1/admin/payments/{id}/notifications': ['ADMIN'],
  'GET /api/v1/payments/vnpay/ipn': [],
  'GET /api/v1/payments/vnpay/return': [],
};
function auditOpenApi(spec) {
  const operations = [];
  const methods = ['get', 'post', 'patch', 'put', 'delete'];
  for (const [path, item] of Object.entries(spec.paths))
    for (const [method, op] of Object.entries(item)) {
      if (!methods.includes(method)) continue;
      const key = method.toUpperCase() + ' ' + path;
      assert.ok(key in routes, 'Unexpected P0 operation ' + key);
      const roles = routes[key];
      equalJson(op['x-roles'], roles, key + ' roles');
      assert.equal(
        !!op.security?.some((s) => 'bearer' in s),
        roles.length > 0,
        key + ' bearer/public contract',
      );
      assert.ok(op.summary, key + ' summary');
      const provider = path.endsWith('/vnpay/ipn');
      for (const [status, response] of Object.entries(op.responses)) {
        if (Number(status) >= 400)
          assert.equal(
            response.content?.['application/json']?.schema?.$ref,
            '#/components/schemas/ErrorEnvelope',
            key + ' safe error schema',
          );
        if (status === '204')
          assert.equal(response.content, undefined, key + ' empty204');
      }
      if (roles.length)
        for (const status of ['401', '403'])
          assert.ok(op.responses[status], key + ' ' + status);
      if (!provider)
        for (const status of ['500', '503'])
          assert.ok(op.responses[status], key + ' ' + status);
      for (const p of op.parameters ?? [])
        if (p.in === 'path')
          assert.equal(p.schema.format, 'uuid', key + ' UUID');
      operations.push({
        method: method.toUpperCase(),
        path,
        roles,
        authentication: op['x-authentication'],
        responses: Object.keys(op.responses),
        queries: (op.parameters ?? [])
          .filter((p) => p.in === 'query')
          .map((p) => p.name),
      });
    }
  equalJson(
    operations.map((o) => o.method + ' ' + o.path).sort(),
    Object.keys(routes).sort(),
    'Complete P0 operation inventory',
  );
  const get = (path, method = 'get') => spec.paths['/api/v1/' + path][method];
  const queries = (path) =>
    get(path)
      .parameters.filter((p) => p.in === 'query')
      .map((p) => p.name);
  equalJson(queries('products'), [
    'offset',
    'limit',
    'q',
    'minPriceVnd',
    'maxPriceVnd',
    'sort',
  ]);
  assert.ok(get('orders/{id}/cancel', 'post').responses['409']);
  for (const path of ['orders/{id}/cancel', 'orders/{id}/payment-attempts'])
    assert.equal(
      get(path, 'post').requestBody.content['application/json'].schema
        .maxProperties,
      0,
    );
  assert.ok(
    get('products/{id}/image', 'post').requestBody.content[
      'multipart/form-data'
    ],
  );
  assert.equal(
    get('products/{id}/image').responses['200'].content['image/png'].schema
      .format,
    'binary',
  );
  const ipn = get('payments/vnpay/ipn');
  equalJson(Object.keys(ipn.responses), ['200']);
  const ack = ipn.responses['200'].content['application/json'].schema;
  equalJson(ack.properties.RspCode.enum, ['00', '02', '01', '04', '97', '99']);
  assert.equal(ack.properties.success, undefined);
  for (const suffix of ['ipn', 'return']) {
    const op = get('payments/vnpay/' + suffix);
    for (const field of [
      'vnp_TmnCode',
      'vnp_TxnRef',
      'vnp_Amount',
      'vnp_OrderInfo',
      'vnp_ResponseCode',
      'vnp_TransactionStatus',
      'vnp_TransactionNo',
      'vnp_SecureHash',
    ])
      assert.ok(op.parameters.some((p) => p.name === field && p.required));
  }
  let moneyFields = 0;
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'properties')
        for (const [name, schema] of Object.entries(child))
          if (name.endsWith('Vnd')) {
            assert.equal(schema.type, 'string', name + ' exact VND string');
            moneyFields++;
          }
      walk(child);
    }
  }
  walk(spec);
  assert.ok(moneyFields >= 10, 'Money contracts present');
  for (const [name, schema] of Object.entries(spec.components.schemas))
    if (name.endsWith('Dto'))
      assert.equal(schema.additionalProperties, false, name + ' whitelist');
  return {
    pathCount: Object.keys(spec.paths).length,
    operationCount: operations.length,
    moneyFields,
    operations,
  };
}
module.exports = { auditOpenApi };
