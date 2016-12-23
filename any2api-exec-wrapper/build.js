#!/usr/bin/env node

'use strict';

const fs = require('fs-extra');
const path = require('path');
const async = require('async');
const _ = require('lodash');
const yaml = require('js-yaml');
const grpc = require('grpc');

const wrapDir = process.env.WRAP_DIR || '/wrap';
const apiDir = process.env.API_DIR || '/api';
const wrapper = process.env.WRAPPER;

const wrapYml = yaml.safeLoad(fs.readFileSync(path.join(wrapDir, 'wrap.yml'), 'utf8'));

const metaYml = {
  messages: {},
  services: {},
  methods: {}
};

const mainProtoServices = {}

const json2proto = {
  'integer': 'int64',
  'number': 'double',
  'object': 'map<string, Any>',
  'boolean': 'bool',
  'array': 'repeated Any'
};

let mainProto = fs.readFileSync(path.join(__dirname, 'head.proto.tpl'), 'utf8').split('\n');

const asyncOpExists = _.reduce(wrapYml.operations, (asyncOpExists, op) => {
  return op.async || asyncOpExists;
}, false);

if (asyncOpExists) {
  mainProto = mainProto.concat(fs.readFileSync(path.join(__dirname, 'async.proto.tpl'), 'utf8').split('\n'));
}

mainProto = mainProto.concat([
  'message Config {',
  //'  bool start = 1;',
  '  map<string, string> env = 10;',
  '  string cwd = 11;',
  '  string base_dir = 12;',
  '  string stdin = 13;',
  '  bool sudo = 14;',
  '  string sudo_user = 15;',
  '  string sudo_password = 16;',
  '  string ssh_host = 100;',
  '  int32 ssh_port = 101;',
  '  string ssh_user = 102;',
  '  string ssh_privatekey = 103;',
  '  repeated string exclude_results = 200;'
  //'  string encoding_stdout = 201;'
  //'  string encoding_stderr = 202;'
]);

if (wrapper === 'python-wrapper') {
  mainProto.push('  string py_version = 300;');
  mainProto.push('  string py_virtualenv = 301;');
  mainProto.push('  string py_requirements = 302;');
  mainProto.push('  bool py_install_requirements = 303;');
}
//TODO add more config params for other wrappers: ruby Gemfile etc.

mainProto.push('}');
mainProto.push('');



async.series([
  (done) => {
    fs.ensureDir(apiDir, done);
  },
  (done) => {
    metaYml.title = wrapYml.title;
    metaYml.description = wrapYml.description;

    try {
      _.forEach(wrapYml.operations, (op, opName) => {
        if (op.service === 'Operations') {
          throw new Error('service name "Operations" is reserved');
        }

        const serviceName = op.service || 'Main';

        metaYml.services[serviceName] = metaYml.services[serviceName] || {};

        mainProtoServices[serviceName] = mainProtoServices[serviceName] || [
          `service ${serviceName} {`
        ];

        const methodName = _.upperFirst(_.camelCase(opName));

        if (metaYml.methods[`${serviceName}.${methodName}`]) {
          throw new Error(`operation "${opName}" translates to method "${methodName}", which already exists`);
        }

        metaYml.methods[`${serviceName}.${methodName}`] = {
          operation_name: opName,
          description: op.description,
          rest: op.rest
        };

        // parameters
        const paramsName = methodName + 'Parameters';

        metaYml.messages[paramsName] = {
          fields: {}
        };

        mainProto.push(`message ${paramsName} {`);

        let paramsProto = mainProto;

        if (op.stream === 'in' || op.stream === 'bi') {
          paramsProto = [
            'oneof input {',
          ];
        }

        let paramTagIndex = 1;

        paramsProto.push(`  Config config = ${paramTagIndex++};`);

        if (!_.isEmpty(op.parameters)) {
          _.forEach(op.parameters, (p, pName) => {
            const fieldName = _.snakeCase(pName);

            if (op.service === 'config') {
              throw new Error('parameter field name "config" is reserved');
            } else if (metaYml.messages[paramsName].fields[fieldName]) {
              throw new Error(`parameter "${pName}" translates to field "${fieldName}", which already exists`);
            }

            metaYml.messages[paramsName].fields[fieldName] = {
              parameter_name: pName,
              description: p.description,
              default: p.default,
              mime_type: p.mime_type,
              in: p.in
            };

            let type = json2proto[p.type] || p.type;

            if (!_.isEmpty(p.proto)) {
              type = _.upperFirst(fieldName);

              mainProto.push(`  message ${_.upperFirst(fieldName)} {`);
              mainProto.push('    ' + p.proto.trim().split('\n').join('\n    '));
              mainProto.push('  }');
            }

            paramsProto.push(`  ${type} ${fieldName} = ${paramTagIndex++};`);
          });
        }

        if (paramsProto !== mainProto) {
          paramsProto.push('}');

          mainProto = mainProto.concat(_.map(paramsProto, line => '  ' + line ));
        }

        mainProto.push('}');
        mainProto.push('');

        // results
        let resultsName = 'Empty';

        if (!_.isEmpty(op.results)) {
          resultsName = methodName + 'Results';

          metaYml.messages[resultsName] = {
            fields: {}
          };

          mainProto.push(`message ${resultsName} {`);

          let resultsProto = mainProto;

          if (op.stream === 'out' || op.stream === 'bi') {
            resultsProto = [
              'oneof output {',
            ];
          }

          let resultTagIndex = 1;

          _.forEach(op.results, (r, rName) => {
            const fieldName = _.snakeCase(rName);

            if (metaYml.messages[resultsName].fields[fieldName]) {
              throw new Error(`result "${rName}" translates to field "${fieldName}", which already exists`);
            }

            metaYml.messages[resultsName].fields[fieldName] = {
              result_name: rName,
              description: r.description,
              mime_type: r.mime_type,
              in: r.in
            };

            let type = json2proto[r.type] || r.type;

            if (!_.isEmpty(r.proto)) {
              type = _.upperFirst(fieldName);

              mainProto.push(`  message ${_.upperFirst(fieldName)} {`);
              mainProto.push('    ' + r.proto.trim().split('\n').join('\n    '));
              mainProto.push('  }');
            }

            resultsProto.push(`  ${type} ${fieldName} = ${resultTagIndex++};`);

            if (resultsProto !== mainProto) {
              resultsProto.push('}');

              mainProto = mainProto.concat(_.map(resultsProto, line => '  ' + line ));
            }
          });

          mainProto.push('}');
          mainProto.push('');
        }

        let methodDef = `  rpc ${methodName}`;

        if (op.stream === 'in' || op.stream === 'bi') {
          methodDef += `(stream ${paramsName}) `;
        } else {
          methodDef += `(${paramsName}) `;
        }

        if (op.async) {
          methodDef += 'returns (Invocation) {}';
        } else if (op.stream === 'out' || op.stream === 'bi') {
          methodDef += `returns (stream ${resultsName}) {}`;
        } else {
          methodDef += `returns (${resultsName}) {}`;
        }

        mainProtoServices[serviceName].push(methodDef);
      });
    } catch (err) {
      return done(err);
    }

    _.forEach(mainProtoServices, (service) => {
      service.push('}');
      service.push('');

      mainProto = mainProto.concat(service);
    });

    done();
  },
  (done) => {
    fs.writeFile(path.join(apiDir, 'main.proto'), mainProto.join('\n'), done);
  },
  (done) => {
    fs.writeFile(path.join(apiDir, 'meta.yml'), yaml.safeDump(metaYml, {
      skipInvalid: true
    }), 'utf8', done);
  },
  (done) => {
    try {
      const services = grpc.load(path.join(apiDir, 'main.proto'));
    } catch (err) {
      return done(err);
    }

    done();
  }
], (err) => {
  if (err) {
    console.error(err.toString());
    process.exit(1);
  }

  process.exit();
});
