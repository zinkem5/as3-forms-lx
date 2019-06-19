/*
  Copyright (c) 2019, F5 Networks, Inc.
  Author: Matthew Zinke <m.zinke@f5.com>
*/

'use strict';
const querystring = require('querystring');

const at_util = require('./lib/at_util.js');
const ATRequest = at_util.ATRequest;

const template_provider = require('./lib/template_provider.js');
const FsTemplateProvider = template_provider.FsTemplateProvider;

const html_engine = require('./lib/html_engine.js');
const HtmlTemplate = html_engine.HtmlTemplate;

const configPath = '/var/config/rest/iapps/as3-forms-lx';

function TemplateWorker() {
    this.state = {};
    this.provider = new FsTemplateProvider(`${configPath}/templates`, `${configPath}/schemas`);
}

TemplateWorker.prototype.WORKER_URI_PATH = "shared/as3-forms-lx";
TemplateWorker.prototype.isPublic = true;
TemplateWorker.prototype.isPersisted = true;
TemplateWorker.prototype.isPassThrough = true;
TemplateWorker.prototype.isStateRequiredOnStart = false;

TemplateWorker.prototype.onStart = function(success, error) {
    //if the logic in your onStart implementation encounters and error
    //then call the error callback function, otherwise call the success callback
    var err = false;
    if (err) {
        this.logger.severe("TemplateWorker onStart error: something went wrong");
        error();
    } else {
        this.logger.fine("TemplateWorker onStart success");
        success();
    }
};

TemplateWorker.prototype.onStartCompleted = function (success, error, state, errMsg) {
    if (errMsg) {
        this.logger.severe("TemplateWorker onStartCompleted error: something went wrong " + errMsg);
        error();
    }

    this.logger.fine("TemplateWorker state loaded: " + JSON.stringify(state));
    success();
};

/*****************
 * http handlers *
 *****************/

const as3_html_view = (response) => {
  // we need to pre-process the declaration to make
  // it more suitable to build a mustache partial
  // build a list of tenants with a list of applications inside
  //console.log(JSON.stringify(response, null, 2));

  const results = response.body.results;
  const declaration = response.body.declaration || response.body;
  //console.log(JSON.stringify(declaration, null, 2));
  const tenantList = Object.keys(declaration)
    .filter( k => declaration[k].class === 'Tenant')
    .map( k => Object.assign(declaration[k], {tname: k}) );

  var count = 0;
  tenantList.forEach((t) => {
    t.applicationList = Object.keys(t)
      .filter( k => t[k].class === 'Application')
      .map( k => Object.assign(t[k], {
        aname: k,
        row: (count++%2) == 1,
       }) );

    //finally, we will take every object with a class
    //and build a class array inside the application

    t.applicationList.forEach((app) => {
      app.componentList = Object.keys(app)
        .filter(k => app[k].class !== undefined)
        .map(k=> Object.assign(app[k], {cname: k }))
    })
  });

  const view = {
    table_rows: tenantList,
    tenant_summary() {
      const html = this.applicationList.map((a) => {
        if (a.label) {
          return `<div class="highlight group">
          <div style="flex-grow: 1;">${a.name}</div><div>${a.constants}</div>
          </div>`;
        }
        return `<div class="group">${a.name}</div>`;
      }).join('');
      return html;
    },
  };

  //console.log(JSON.stringify(view, null, 2));

  const partial = {
    row_values: `<td><h2>{{tname}}</h2></td>
    <td><div class="container">
    {{#applicationList}}{{> applicationList }}{{/applicationList}}
    </div></td>`,
    applicationList: `
    <div>
      <div class="highlight group" {{#row}}style="background-color:{{CurrentLine}};"{{/row}}>
        <div style="flex-grow: 1;text-align:left;">
        {{#constants}}
        <a href="/iapps/as3-forms-lx/?application_name={{aname}}&tenant_name={{tname}}">{{aname}}</a>
        {{/constants}}
        {{^constants}}
        <u>{{aname}}</u> No Form Values Stored
        {{/constants}}
        </div>
        {{#constants}}
        <div style="flex-grow: 1;text-align:right;">{{label}}</div>
        {{/constants}}
        {{^constants}}
        <div style="flex-grow: 1;text-align:right;">{{serviceMain.class}}</div>
        {{/constants}}
        <div>{{serviceMain.virtualAddresses[0]}}</div>
        <div>{{serviceMain.virtualport}}</div>
      </div>
    </div>
    `,
    componentList:`
    <div>{{class}}</div>
    `
  };

  //partial.row_values = tenantsRow;

  const list_base = new HtmlTemplate('partial_html');
  const artifact = list_base.render(view, partial);

  return artifact;
}

TemplateWorker.prototype.onGet = function(restOperation) {

    const uri = restOperation.getUri();
    this.logger.info(uri);
    const path_elements = uri.path.split('/');
    this.logger.info(path_elements);
    if ( path_elements[3] === 'list') {
      const list_html_template = new HtmlTemplate('list_html');
      const list_html = view => list_html_template.render(view);
      this.logger.info('trying to list...')
      // list templates
      return this.provider.list().then((template_list) => {
        const list_html_view = {
          list_items: template_list,
          prop: function() { return this; },
        };

        restOperation.setHeaders('Content-Type', 'text/html');
        restOperation.setBody(list_html(list_html_view));
        this.completeRestOperation(restOperation);
      }).catch((e) => {
        restOperation.setBody({
          code: 500,
          message: e.stack,
        })
        this.completeRestOperation(restOperation);
      });
    }

    if( path_elements[3] === 'declaration' ) {

      const as3req = new ATRequest({
        ipaddress: 'localhost',
        username: 'admin',
        password: '',
        port: 8100
      })

      return as3req.declaration()
        .then((response) => {
          if( path_elements[4] && path_elements[5] ) {
            const tenant = path_elements[4];
            const app = path_elements[5];
            const declaration = response.body.declaration || response.body;
            return this.provider.fetch(declaration[tenant][app].label)
              .then((templateEngine) => {
                console.log('CONSTANTS!!!', declaration[tenant][app].constants);
                return templateEngine.loadWithDefaults(declaration[tenant][app].constants);
              });
          } else {
            return as3_html_view(response);
          }
        })
        .then((html) => {
          restOperation.setHeaders('Content-Type', 'text/html');
          restOperation.setBody(html);
          this.completeRestOperation(restOperation);
        })
        .catch((e) => {
          restOperation.setBody({
            code: 500,
            message: e.stack,
          })
          this.completeRestOperation(restOperation);
        });
    }

    // display template html/schema
    // as3-form-lx/template_name.json
    // return schema

    // as3-form-lx/template_name
    // as3-form-lx/template_name.html
    // return html form
    const template_name = path_elements[3] || 'f5_service';
    return this.provider.fetch(template_name)
      .then((templateEngine) => {
          restOperation.setHeaders('Content-Type', 'text/html');
          this.logger.info('trying to return...');
          this.logger.info(templateEngine);
          this.logger.info(templateEngine.form_html);
          restOperation.setBody(templateEngine.form_html());
          this.completeRestOperation(restOperation);
      })
      .catch((e) => {
        restOperation.setBody({
          code: 500,
          message: e.stack,
        });
        this.completeRestOperation(restOperation);
      });
};

TemplateWorker.prototype.onPost = function(restOperation) {
    const body = restOperation.getBody();
    const uri = restOperation.getUri();
    const path_elements = uri.path.split('/');
    const template_name = path_elements[3];

    // if x-http-form-encoded...
    const completed_form = JSON.parse(body);
    this.logger.info(uri);
    this.logger.info(body);
    this.logger.info(template_name);
    // console.log('POST Template task '+req.params.template);
    var app_names = [];
    const as3Req = new ATRequest({
      ipaddress: 'localhost',
      username: 'admin',
      password: '',
      port: 8100
    });
    return this.provider.fetch(template_name)
      .then((templateEngine) => {
        // execute :template
        this.logger.info('pre-render');
        this.logger.info(completed_form);
        const err = templateEngine.validate(completed_form);
        if (err) throw new Error('template validation failed: '+JSON.stringify(err));
        const rendered = templateEngine.render(completed_form);
        this.logger.info(rendered);
        return Promise.all([rendered, as3Req.declaration()]);
      })
      .then((declaration) => {
        const _new = declaration[0];
        const _existing = declaration[1].body;
        this.logger.info('post-render');
        //console.log('new')
        //console.log(_new)
        //console.log('existing')
        //console.log(_existing)
        // grab ADC class
        const _final = _existing.class === 'AS3' ? _existing.declaration : _existing;
        const _newadc = _new.class === 'AS3' ? _new.declaration : _new;
        // stitch...
        //console.log('newadc')
        //console.log(_newadc)
        //console.log('final')
        //console.log(_final)

        //filter out unwanted tenants
        Object.keys(_final).forEach((k) => {
          if( !_newadc[k] )
            delete _final[k];
        });
        console.log('before', _final);
        Object.keys(_newadc)
          .filter(k => _newadc[k].class === 'Tenant')
          .forEach((k) => {
            this.logger.info('stitching '+k);
            this.logger.info(JSON.stringify(_newadc[k]));
            app_names.push(Object.keys(_newadc[k]).filter(x => x.class === 'Application'));
            if (_final[k])
              Object.assign(_final[k], _newadc[k]);
            else
              _final[k] = _newadc[k];
          });

        console.log('final after final mod');
        console.log(JSON.stringify(_final, null, 2));
        return as3Req.declare(_final);
      })
      .then((response) => {
        this.logger.info(JSON.stringify(response, null, 2));

        if( !response.body.results )
          throw new Error('Report this irregular AS3 result:' + JSON.stringify(response.body, null, 2));

        if( response.body.results )
          response.body.results.push('iControl LX wont let me return HTML in a POST response.')

        const view = {
          table_rows: response.body.results || response.body,
        };
        const partial = {
          row_values: `<td>{{message}}</td>{{code}}<td>{{result}}</td>`,
        };
        const list_base = new HtmlTemplate('partial_html');
        const response_view = list_base.render(view, partial);
        restOperation.setBody({
          application_name: JSON.stringify(app_names),
          reuslts: response.body.results.filter(x => x.tenant)
        });
        this.completeRestOperation(restOperation);
      }).catch((e) => {
        console.log(e.stack);
        restOperation.setBody({
          code: 500,
          message: e.stack,
        })
        this.completeRestOperation(restOperation);
      });
};

// create new template file
TemplateWorker.prototype.onPut = function(restOperation) {
    this.state = restOperation.getBody();
    this.completeRestOperation(restOperation);
};

 // update existing template file
TemplateWorker.prototype.onPatch = function(restOperation) {
    this.state = restOperation.getBody();
    this.completeRestOperation(restOperation);
};

// delete template file
TemplateWorker.prototype.onDelete = function(restOperation) {
    this.state = {};
    this.completeRestOperation(restOperation.setBody(this.state));
};

module.exports = TemplateWorker;
