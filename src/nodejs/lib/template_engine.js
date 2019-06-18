
const Mustache = require('mustache');
const Ajv = require('ajv');
const uuid = require('uuid/v4');

const ajv = new Ajv({ coerceTypes: 'array', useDefaults: true });

Mustache.escape = function (text) {
  return text;
};

// template variable names that cannot be used because
// they have special meaning
const ignored = [
  'template_name',
  'uuid',
].reduce((acc, cur) => {
  acc[cur] = true;
  return acc;
}, {});

const templateToParams = (template) => {
  var description = '';
  return ((props) => {
    // console.log(props);
    const paramsTable = props.reduce((acc, cur) => {
      if (cur[0] === 'name' && !ignored[cur[1]]) {
        const param = cur[1].split(':');
        if (!acc[param[0]] || !acc[param[0]].includes(':')) acc[param[0]] = cur[1];
      } else if (cur[0] === '!' && description === '') {
        description = cur[1];
      }
      return acc;
    }, {});
    // console.log(paramsTable);
    return {
      params: paramsTable,
      description,
    };
  })(Mustache.parse(template).filter(x => x[0] !== 'text'));
};

// create schema for AS3 template
const templateToSchema = (template, schema) => ((props) => {
  const prop_schema = props.reduce((acc, cur) => {
    if (cur[0] === 'name') {
      const param = cur[1].split(':');
      // console.log('templateToSchema');
      // console.log(props);
      // console.log(param);
      // console.log(schema);
      var new_def;
      const definition = (() => {
        if (param[1]) {
          // handle schema type lookup
          new_def = schema[param[1]].definitions[param[2]];
          if (!new_def) throw new Error(`No schema definition for ${param[1]}/${param[2]}`);
          return new_def;
        }

        const primitives = [
          'boolean',
          'object',
          'array',
          'number',
          'string',
        ];

        new_def = { type: 'string' };

        if (param[2]) {
          if (primitives.some(x => x === param[2])) {
            new_def.type = param[2];
          }

          if (param[2] === 'text') {
            new_def.contentMediaType = 'text/plain';
          }
        }

        new_def.default = (() => {
          if (new_def.type === 'array') return ['10.0.1.1'];
          if (new_def.type === 'boolean') return true;
          if (new_def.type === 'number') return 131;
          return 'myComponent';
        })(param);

        return new_def;
      })();

      // experimental: defaults for specific variable names
      // overrides what is in schema, currently.
      const defaults_table = {
        tenant_name: 'myTenant',
        application_name: 'myApp',
        server_port: 443,
      };
      if (defaults_table[param[0]]) definition.default = defaults_table[param[0]];

      if ((!acc[param[0]] || param[1]) && !ignored[param[0]]) acc[param[0]] = definition;
    }
    return acc;
  }, {});

  return {
    type: 'object',
    properties: prop_schema,
    required: Object.keys(prop_schema),
  };
})(Mustache.parse(template).filter(x => x[0] !== 'text'));

// const form_html_template = fs.readFileSync('./html/form_html.mst').toString('utf8');
const HtmlTemplate = require('./html_engine.js').HtmlTemplate;

const form_html_template = new HtmlTemplate('form_html');

// used for as3 templates
function TemplateEngine(template_name, template_text, schemaSet) {
  this.template_name = template_name;
  this.schemaSet = schemaSet;
  this.as3_template = template_text;

  const schema_meta_data = templateToParams(this.as3_template);
  this.as3_params_table = schema_meta_data.params;
  this.template_description = schema_meta_data.description;

  this.as3_view_schema = templateToSchema(this.as3_template, schemaSet);
  this._validate = ajv.compile(this.as3_view_schema);

  const form_html_view = {
    template_name: this.template_name,
    template_description: this.template_description,
    form_items: Object.keys(this.as3_view_schema.properties)
      .map((prop) => {
        const defn = this.as3_view_schema.properties[prop];
        const new_view = {
          name: prop,
          required: this.as3_view_schema.required.some(k => k === prop) ? 'required' : null,
          type: (() => {
            if (defn.enum) return 'enum';
            return defn.contentMediaType || defn.type;
          })(),
          array: defn.type === 'array',
          value: defn.default,
          options: defn.enum || [],
        };
        return new_view;
      }),
    item_form_element() {
      const emap = {
        'text/plain': `<textarea rows="4" cols="50" name="${this.name}" ${this.required}></textarea>`,
        boolean: `<input type="checkbox" name="${this.name}">`,
        array: this.value instanceof Array
          ? this.value.map(v => `<input type="text" name="${this.name}" value="${v}" ${this.required}>`).join('</div><div class="p_input">') : '',
        enum: [
          `<select name="${this.name}">`,
          this.options.map(x => `<option value="${x}">${x}</option>`).join(''),
          '</select>',
        ].join(''),
      };
      // console.log('type:', this.type, this.name);
      if (emap[this.type]) return emap[this.type];

      return `<input type="text" name="${this.name}" value="${this.value}" ${this.required}>`;
    },
  };
  this.form_html_view = form_html_view;
  this.form_html = (targets) => {
    // const populated = Object.assign(form_html_view, { targets });
    // console.log('o', populated);
    return form_html_template.render(form_html_view);
  };
  return this;
};

TemplateEngine.prototype.loadWithDefaults = function (defaults) {
  if (!defaults) throw new Error('TemplateEngine.loadWithDefaults: null defaults!');
  const app_form_view = this.form_html_view;
  app_form_view.form_items.forEach((e) => {
    e.value = defaults[e.name];
  });
  app_form_view.targets = [defaults.target];
  // console.log(form_html_template.html_template);
  // console.log(app_form_view);
  // console.log(defaults);
  return form_html_template.render(app_form_view);
};

TemplateEngine.prototype.validate = function (input) {
  const valid = this._validate(input);
  if (valid) return null;
  return this._validate.errors;
};

TemplateEngine.prototype.render = function (input) {
  console.log(input);
  const view = Object.keys(this.as3_view_schema.properties).reduce((acc, key) => {
    // //console.log(key);
    const text = input[key];
    // this translates simple variable names into
    // fully specified types for the template replacement
    const view_param = this.as3_params_table[key];
    if (!view_param) return acc;
    const type_info = view_param.split(':');

    if (type_info[2]) {
      if (type_info[2] === 'number'
          || type_info[2] === 'boolean') {
        acc[view_param] = text;
      } else {
        acc[view_param] = JSON.stringify(text);
      }
    } else {
      acc[view_param] = text;
    }
    return acc;
  }, {
    template_name: this.template_name,
    uuid: input.uuid || uuid().substring(0, 8),
  });
  Object.assign(view, input);
  console.log(view);
  console.log(this.as3_template);
  const foo = Mustache.render(this.as3_template, view);
  console.log(foo);
  return foo;
};

module.exports = {
  TemplateEngine,
};