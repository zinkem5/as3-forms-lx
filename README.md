# AS3 Forms LX (Preview)

AS3 Forms LX (AFL) is an iControl LX Extension for creating solution tailored
UI Forms and BIG-IP REST endpoints for deploying AS3 Applications.

**requirements**
* BIG-IP running TMOS >= 13.0
* [AS3](https://github.com/F5Networks/f5-appsvcs-extension) previously installed

## Quickstart

Download as3-forms-lx.rpm from latest releases

Install the RPM on your BIG-IP

Navigate to `http://your.big-ip.host/iapps/as3-forms-lx/`

This will display the list of default templates, which are also made available
on [github](https://github.com/zinkem5/f5-as3-templates). Clicking a link to
a template will present a form to fill out. Once filled in, clicking submit will
apply the templated declaration to BIG-IP.

Templates can be modified by changing the files at `/var/config/rest/iapps/as3-forms-lx/templates`
Schemas can be modified by changing the files at `/var/config/rest/iapps/as3-forms-lx/schemas`

## Introduction

AS3 greatly simplifies application deployment on BIG-IP, but writing AS3
declarations by hand can lead to some uncomfortable outcomes.

* Copy and pasting the same declaration snippet and replacing only a few values,
  the 'copy-paste' workflow.
* Proliferation of unique or mutated configuration structures throughout the
  declaration

The next step is to write a frontend to provide a visual or simplified interface
for AS3, composing declarations programatically. This approach enables network
admins to deploy applications with AS3, even though they may not know AS3.

What AFL provides is a custom template expansion language, [Typestache](#typestache)
for specifying AS3 Applications, and a process for integrating these Applications
into the existing configuration.

Typestache templates may be added to the system (some defaults are provided),
and a schema will be auto-generated from each template. This schema is then used
to render an appropriate HTML form and validate inputs before rendering the
template.

When an application configuration needs to be added, a template is chosen and
form values filled in. Submitting the form deploys the application to BIG-IP in
a complete AS3 declaration.

# Typestache

Typestache is a dialect of [mustache](https://mustache.github.io) that allows a
template author to specify data types to be filled in during the render phase.
Types are provided in schema files, specified in a subset of JSON schema. This
type information can be consumed and used to auto-generate a front end for the
templates.

###Basic Rules

* Variables will be marked for replacement at render time.
* Variables are surrounded with double curly braces, `{{` and `}}`.
* Variables can specify a type: `name`::`type`
* Primitive Types
  * string (default)
  * text (for strings with newlines and escape characters)
  * number
  * boolean
  * array (treated as array of strings, see [extended types](#extended-types)
    for other arrays)

###Example

The following is an example of a simple Typestache template that will render an
AS3 declaration:

```mustache
{
    "class": "ADC",
    "schemaVersion": "3.11.0",
    "{{tenant_name}}": {
      "class": "Tenant",
      "{{application_name}}": {
        "class": "Application",
        "template": "http",
        "serviceMain": {
          "class": "Service_HTTP",
          "virtualAddresses": ["{{virtual_address}}"],
          "pool": "web_pool_{{port}}",
        },
        "web_pool_{{port}}": {
          "class": "Pool",
          "monitors": [
            "http"
          ],
          "members": [
            {
              "servicePort": {{port::number}},
              "serverAddresses": {{server_addresses::array}}
            }
          ]
        }
      }
    }
  }
}
```
The following schema will get auto-generated from the example:

```json
{
  "properties": {
    "tenant_name" : {
      "type": "string"
    },
    "application_name" : {
      "type": "string"
    },
    "virtual_address" : {
      "type": "string"
    },
    "server_addresses" : {
      "type": "array"
    },
    "port" : {
      "type": "number"
    },
  }
}
```

The example schema can validate the object the admin or upstream caller provides
(also known as a 'view'):

```json
{
  "tenant_name" : "myTenant",
  "application_name" : "simple_http_1",
  "virtual_address" : "10.0.0.1",
  "server_addresses" : [ "10.0.1.1", "10.0.2.2" ],
  "port" : 80
}
```

At render time, the view will get translated in the actual view the template
gets rendered with. A couple system variables, `template_name` and `uuid` are
added to be used in templates.

Variables may be used in multiple places, if a variable is annotated somewhere
in the file, an unannotated version of that variable will result in a string
representation of that variable. The view is filled in to provide this behavior.

```json
{
  "template_name" : "<name of the template being run>",
  "uuid" : "<a uuid id generated by the system at render time>",

  "tenant_name" : "myTenant",
  "application_name" : "simple_http_1",
  "virtual_address" : "10.0.0.1",
  "server_addresses" : "[ \"10.0.1.1\", \"10.0.2.2\" ]",
  "server_addresses::array" : [ "10.0.1.1", "10.0.2.2" ],
  "port" : "80",
  "port::number" : 80
}
```

The final declaration is generated by providing the previous view with the
provided template:

```json
{
    "class": "ADC",
    "schemaVersion": "3.11.0",
    "myTenant": {
      "class": "Tenant",
      "simple_http_1": {
        "class": "Application",
        "template": "http",
        "serviceMain": {
          "class": "Service_HTTP",
          "virtualAddresses": ["10.0.0.1"],
          "pool": "web_pool_80",
        },
        "web_pool_80": {
          "class": "Pool",
          "monitors": [
            "http"
          ],
          "members": [
            {
              "servicePort": 80,
              "serverAddresses": [ "10.0.1.1", "10.0.2.2" ]
            }
          ]
        }
      }
    }
  }
}
```

### Extended Types

Typestache also allows specification of custom types using JSON schema. Schema
files can be placed into `/var/config/rest/iapps/as3-forms-lx/schemas`. Each
file must have a `.json` extension and contain valid JSON schema. Schemas listed
in the `definitions` will be made available to templates using the following
syntax:

`name`:`schema_name`:`type`

* **name** is the name of the variable, as before
* **schema_name** is the name of the JSON schema file, excluding the extension
* **type** is the property name of the definition being referenced

for example,
```
...
{
  "class": {{service_type:f5:service}}
  ...
}
...
```
AFL has support for `enums` and custom formats can be applied to the primitive
types outlined in the previous section. The variable in the example is a
`service` type from the `f5` schema named `service_type`. The `service` schema
is an enum containing the AS3 basic services, `Service_HTTP`, `Service_HTTPS`,
`Service_L4`, `Service_UDP`, and `Service_TCP`.

The definition from f5.json:
```
"service": {
  "type": "string",
  "enum": [
    "Service_HTTP",
    "Service_HTTPS",
    "Service_TCP",
    "Service_UDP",
    "Service_L4"
  ],
  "default": "Service_HTTP"
},
```

Arrays of primitives should work fine, but has not been tested extensively.

Objects are not supported yet.
