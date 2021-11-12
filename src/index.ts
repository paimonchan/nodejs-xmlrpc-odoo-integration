import xmlrpc from 'xmlrpc'
import {URL} from 'url'

const RPC_PATH_COMMON = '/xmlrpc/2/common'
const RPC_PATH_OBJECT = '/xmlrpc/2/object'
// TODO: check on db.py and posibility callable function.
//       add checking version odoo before call this path.
const RPC_PATH_DB = '/xmlrpc/2/db'

interface Input {
    model       : string,
    method?     : string,
    record_ids? : number[],
    args?       : unknown[],
    kwargs?     : Record<string, unknown>,
    context?    : Record<string, unknown>,
    domain?     : unknown[] | null,
    fields?     : unknown[] | null,
    vals?       : Record<string, unknown>,
    limit?      : number | null,
    offset?     : number | null,
    order?      : string | null,
}

class OdooXMLRPC {
    private config!: Record<string, number | string>
    private client!: xmlrpc.Client
    private uid!: number

    /* construct error message for rpc error */
    private getRPCError = (message: string) => {
        const formatError = {
            name        : 'RPC Error',
            code        : 'rpc_error_code',
            message     :  message,
        }
        return formatError
    }

    /* create rpc client over http or https */
    private getClient = (rpcPath: string): xmlrpc.Client => {
        const {host, port} = this.config
        const urlProperty = new URL(String(host))
        const options = {
            host        : urlProperty.host,
            port        : Number(port),
            path        : rpcPath,
        }
        if (urlProperty.protocol === 'http:') {
            this.client = xmlrpc.createClient(options)
        } else {
            this.client = xmlrpc.createSecureClient(options)
        }
        return this.client
    }

    /**
     * get parameters that must exist in rpc transaction 
     * @return [database, uid or username, password]
     */
    private getRequiredParams = () => {
        const {database, username, password, uid} = this.config;
        const params = [database, uid || username, password]
        return params;
    }

    /**
     * check if user already login or not.
     * when you pass uid on configuration, it mean you already know the identifier of the user,
     * an so we expect you already login. (this help to reduce api call by skip call authenticate method again)
     */
    private alreadyLogin = () => {
        return this.uid && this.uid > 0
    }

    /** 
     * convert response data for many2one field from odoo into object.
     * this will convert this type response [id, name] into {id: id, name:name}
     * @param {string} model            : odoo model name (table name)
     * @param {list} response           : response data from `search` method
    */
    private sanitizeSearchResponseToObject = async ({model, response}: Record<string, any>) => {
        const fieldsMeta = await this.fields({model: String(model)})
        for (const res of response) {
            for (const key in res) {
                const val = res[key]
                const type = fieldsMeta[key].type
                if (type == 'many2one') {
                    res[key] = {
                        id: val ? val[0] : false,
                        name: val ? val[1] : false,
                    }
                    res[key] = val ? res[key] : {}
                }
                /* make the return type is same for multi relational. */
                else if (type == 'one2many' || type == 'many2many') {
                    res[key] = val ? val : []
                }
            }
        }
    }

    private executeCommon = ({method}: Record<string, unknon>): Promise<any> => {
        //TODO add action to execute common
    } 
    
    /**
     * odoo prepare 2 function to call model function, its `execute` and `execute_kw`
     * @param {string} model            : odoo model name (ex: product.product)
     * @param {string} method           : odoo model function name
     * @param {list} args               : arguments, normaly used to pass record ids
     * @param {dict} kwargs             : kwargs, normaly used to pass method parameter or context
     * @returns list of object or id
     */
    private executeKW = ({model, method, args, kwargs}: Record<string, unknown>): Promise<any> => {
        return new Promise((resolve, reject) => {
            const client = this.getClient(RPC_PATH_OBJECT)
            const requiredParams = this.getRequiredParams()

            let composeParams:unknown[] = []
            composeParams = composeParams.concat(requiredParams)
            /* list ordering params is fixed and can't be switched */
            composeParams = composeParams.concat([model, method, args, kwargs])
            client.methodCall('execute_kw', composeParams, (e: any, value) => {
                if (e) { return reject(this.getRPCError(e?.message)) }
                return resolve(value)
            })
        })
    }

    /**
     * access endpoint related to db
     * @param {string} model            : odoo model name (ex: product.product)
     * @param {list} args               : arguments, normaly used to pass record ids
    */
    private executeDB = ({method, args}: Record<string, unknown>): Promise<[] | number> => {
        return new Promise((resolve, reject) => {
            const client = this.getClient(RPC_PATH_DB)
            let composeParams:unknown[] = []
            if (args) {
                composeParams = composeParams.concat([args])
            }
            const exp_method = String(method)
            client.methodCall(exp_method, composeParams, (e: any, value) => {
                if (e) { return reject(this.getRPCError(e?.message)) }
                return resolve(value)
            })
        })
    }

    /**
     * get odoo res.user id.
     * when uid is set inside config, this function automatically will be skipped.
     * @return id
     */
    private authenticate = (): Promise<number> => {
        return new Promise((resolve, reject) => {
            if (this.alreadyLogin()) {
                return resolve(this.uid)
            }

            const client = this.getClient(RPC_PATH_COMMON)
            const requiredParams = this.getRequiredParams()
            client.methodCall('authenticate', requiredParams, (e: any, uid: number) => {
                if (e) { 
                    return reject(this.getRPCError(e.message))
                }
                if (!uid) {
                    return reject(this.getRPCError('invalid username/password'))
                }
                this.uid = uid
                return resolve(this.uid)
            })
        })
    }

    /**
     * call public function inside odoo model.
     * @param {string} model            : odoo name of model (ex: product.product)
     * @param {string} method           : method name inside a model
     * @param {list} record_ids         : rows id from model
     * @param {list} args               : list arguments
     * @param {dict} kwargs             : list dicitonary parameter
     * @param {dict} context            : odoo context / metadata (like tz, language)
     */
    public call = async ({model, method, record_ids = [], args = [], kwargs = {}, context = {}}: Input) => {
        let composeArgs: unknown[] = []
        const composeKwargs = {...kwargs, context}
        /**
         * set record_ids = [0] if not set. this will enable call method without target record
         * explained:
         * 1. with record_ids           : `self` value in odoo is records itself, and can access all methods.
         *                              :  modify `self` property inside method will affect on the records.
         * 2. without record_ids        : `self` value in odoo is empty, but still can access all methods.
         *                              :  modify `self` property inside method not affect on any records.
         */
        record_ids = record_ids?.length ?? 0 > 0 ? record_ids : [0]
        composeArgs = composeArgs.concat([record_ids])
        composeArgs = composeArgs.concat([args])
        try {
            await this.authenticate()
            const response = await this.executeKW({model, method, args:composeArgs, kwargs:composeKwargs})
            return response
        } catch (e) {
            throw this.getRPCError(e.message)
        }
    }

    /** 
     * get odoo records filtered by domain.
     * @param {string} model            : odoo name of model (ex: product.product)
     * @param {list} domain             : odoo domain (ex: [['active', '=', true]])
     * @param {int} limit               : limit search records
     * @param {int} offset              : offset search record
     * @param {string} order            : order query (ex: 'id desc')
     * @param {list} fields             : column record to return
     * @param {dict} context            : odoo context
     */
    public search = async ({
        model, domain = [[]], limit = null, 
        offset = null, order = null, fields = [], context = {}
    }: Input) => {
        const method = 'search_read'
        const kwargs:Record<string, unknown> = {fields, context}
        /* only pass to params if is set */
        if (limit !== null) {
            kwargs['limit'] = Number(limit)
        }
        /* only pass to params if is set */
        if (offset !== null) {
            kwargs['offset'] = Number(offset)
        }
        /* only pass to params if is set */
        if (order !== null) {
            kwargs['order'] = String(order)
        }
        try {
            const response = await this.executeKW({model, method, args:[domain], kwargs:kwargs})
            return response
        } catch (e) {
            throw this.getRPCError(e.message)
        }
    }

    /** 
     * get odoo records filtered by record ids.
     * @param {string} model            : odoo name of model (ex: product.product)
     * @param {list} record_ids         : rows id from model
     * @param {dict} context            : odoo context
     */
    public browse = async ({model, record_ids, context = {}}: Input) => {
        record_ids = record_ids?.length ?? 0 > 0 ? record_ids : [0]
        const domain = [['id', 'in', record_ids]]
        return await this.search({model, domain, context})
    }

    /**
     * @param {string} model            : odoo name of model (ex: product.product)
     * @param {dict} vals               : columns value per record
     * @param {dict} context            : odoo context
     */
    public create = async ({model, vals = {}, context = {}}: Input) => {
        const method = 'create'
        try {
            await this.authenticate()
            const response = await this.executeKW({model, method, args:[vals], kwargs:{context}})
            return response
        } catch (e) {
            throw this.getRPCError(e.message)
        }
    }

    /**
     * @param {string} model            : odoo name of model (ex: product.product)
     * @param {list} record_ids         : rows id from model
     * @param {dict} context            : odoo context
     */
    public unlink = async ({model, record_ids, context = {}}: Input) => {
        const method = 'unlink'
        try {
            await this.authenticate()
            const response = await this.executeKW({model, method, args:[record_ids], kwargs:{context}})
            return response
        } catch (e) {
            throw this.getRPCError(e.message)
        }
    }

    /**
     * @param {string} model            : odoo name of model (ex: product.product)
     * @param {list} record_ids         : rows id from model
     * @param {dict} vals               : columns value per record
     * @param {dict} context            : odoo context
     */
    public write = async ({model, record_ids = [], vals = {}, context = {}}: Input) =>  {
        const method = 'write'
        try {
            await this.authenticate()
            const response = await this.executeKW({model, method, args:[record_ids, vals], kwargs:{context}})
            return response
        } catch (e) {
            throw this.getRPCError(e.message)
        }
    }

    /** 
     * get count of rows from odoo
     * @param {string} model            : odoo name of model (ex: product.product)
     * @param {dict} context            : odoo context
     */
    public count = async ({model, context = {}}: Input) => {
        const method = 'search_count'
        const kwargs = {context}
        try {
            await this.authenticate()
            const response = await this.executeKW({model, method, kwargs})
            return response
        } catch (e) {
            throw this.getRPCError(e.message)
        }
    }

    /**
     * get fields metadata from a model
     * @param {string} model            : odoo name of model (ex: product.product)
     */
    public fields = async ({model}: Input) => {
        const method = 'fields_get'
        const kwargs = {'attributes':['type']}
        try {
            const response = await this.call({model, method, kwargs})
            return response
        } catch (e) {
            throw this.getRPCError(e.message)
        }
    }

    /**
     * get odoo version
    */
    public version = async () => {
        const method = 'server_version'
        try {
            const response = await this.executeDB({method})
            return response
        } catch (e) {
            throw this.getRPCError(e.message)
        }
    }

    public check = async () => {
        // TODO add action to check healt of the server odoo
    }

    /**
     * set xmlrpc configuration
     * @param {dict} config {
     *      host        : <required, odoo host url: example 'http://localhost'>,
     *      port        : <required, odoo port: example 80|443|8069>,
     *      username    : <required, odoo 'username|useremail'>,
     *      password    : <required, odoo 'userpassword'>,
     *      database    : <required, odoo 'database name'>,
     *      uid         : <optional, odoo 'user id'>
     * }
     */
    public static connect = (config: Record<string, number | string>): OdooXMLRPC => {
        const rpc = new OdooXMLRPC()
        rpc.uid = Number(config.uid || 0)
        rpc.config = config
        return rpc
    }
}

export default OdooXMLRPC