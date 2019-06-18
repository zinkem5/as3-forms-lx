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
      this.provider.list().then((template_list) => {
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

    } else {
      // display template html/schema
      // as3-form-lx/template_name.json
      // return schema

      // as3-form-lx/template_name
      // as3-form-lx/template_name.html
      // return html form
      const template_name = path_elements[3] || 'f5_service';
      this.provider.fetch(template_name)
        .then((templateEngine) => {
            restOperation.setHeaders('Content-Type', 'text/html');
            this.logger.info('trying to return...');
            this.logger.info(templateEngine);
            this.logger.info(templateEngine.form_html);
            restOperation.setBody(templateEngine.form_html());
            this.completeRestOperation(restOperation);
        }).catch((e) => {
          restOperation.setBody({
            code: 500,
            message: e.stack,
          })
          this.completeRestOperation(restOperation);
        });

    }
};

TemplateWorker.prototype.onPost = function(restOperation) {
    const body = restOperation.getBody();
    const uri = restOperation.getUri();
    const path_elements = uri.path.split('/');
    const template_name = path_elements[3]


    // if x-http-form-encoded...
    const completed_form = JSON.parse(body);
    this.logger.info(uri);
    this.logger.info(body);
    this.logger.info(template_name);
    this.logger.info('gmgmgmgmg')
    // console.log('POST Template task '+req.params.template);
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
        if (err) throw new Error(err);
        const rendered = templateEngine.render(completed_form);
        this.logger.info(rendered);
        const rendered_app = JSON.parse(rendered);
        return Promise.all([rendered_app, as3Req.declaration()]);
      })
      .then((declaration) => {
        const _new = declaration[0];
        const _existing = declaration[1].body;
        this.logger.info('post-render');
        console.log('new')
        console.log(_new)
        console.log('existing')
        console.log(_existing)
        // grab ADC class
        const _final = _existing.class === 'AS3' ? _existing.declaration : _existing;
        const _newadc = _new.class === 'AS3' ? _new.declaration : _new;
        // stitch...
        console.log('newadc')
        console.log(_newadc)
        console.log('final')
        console.log(_final)

        Object.keys(_newadc).filter(k => _newadc[k].class === 'Tenant')
          .forEach((k) => {
            Object.assign(_final[k], _newadc[k]);
          });
        console.log('final after final mod');
        this.logger.info(_final);
        return as3Req.declare(_final);
      })
      .then((response) => {
        restOperation.setBody(response);
        this.completeRestOperation(restOperation);
      }).catch((e) => {
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
