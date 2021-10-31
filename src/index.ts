import xmlrpc from 'xmlrpc'
import {URL} from 'url'

const RPC_PATH_COMMON = '/xmlrpc/2/common'
const RPC_PATH_OBJECT = '/xmlrpc/2/object'
// TODO: check on db.py and posibility callable function.
//       add checking version odoo before call this path.
const RPC_PATH_DB = '/xmlrpc/2/db'

interface Input {
    model       : string,
    method      : string,
    record_ids? : number[],
    args?       : unknown[],
    kwargs?     : Record<string, unknown>,
    context?    : Record<string, unknown>,
    domain?     : unknown[],
    fields?     : unknown[],
    vals?       : Record<string, unknown>,
    limit?      : number,
    offset?     : number,
    order?      : string,
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
     * odoo prepare 2 function to call model function, its `execute` and `execute_kw`
     * @param {string} model            : odoo model name (ex: product.product)
     * @param {string} method           : odoo model function name
     * @param {list} args               : arguments, normaly used to pass record ids
     * @param {dict} kwargs             : kwargs, normaly used to pass method parameter or context
     * @returns list of object or id
     */
    private executeKW = ({model, method, args, kwargs}: Record<string, unknown>): Promise<[] | number> => {
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
     * @param {method} method           : method name inside a model
     * @param {list} record_ids         : rows id from model
     * @param {list} args               : list arguments
     * @param {dict} kwargs             : list dicitonary parameter
     * @param {dict} context            : odoo context / metadata (like tz, language)
     */
    public call = async ({model, method, record_ids = [], args = [], kwargs = {}, context = {}}: Input) => {
        let composeArgs: any[] = []
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
        } catch (e: any) {
            throw this.getRPCError(e.message)
        }
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
    public static create = (config: Record<string, number | string>): OdooXMLRPC => {
        const rpc = new OdooXMLRPC()
        rpc.uid = Number(config.uid || 0)
        rpc.config = config
        return rpc
    }
}

export default OdooXMLRPC