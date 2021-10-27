import xmlrpc from 'xmlrpc'
import {URL} from 'url'

const RPC_PATH_COMMON = '/xmlrpc/2/common'
const RPC_PATH_OBJECT = '/xmlrpc/2/object'
// TODO: check on db.py and posibility callable function.
//       add checking version odoo before call this path.
const RPC_PATH_DB = '/xmlrpc/2/db'

class OdooXMLRPC {
    private config!: Record<string, number | string>
    private client!: xmlrpc.Client;

    /* construct error message for rpc error */
    private getRPCErrror = (e: Error) => {
        const formatError = {
            name        : 'RPC Error',
            code        : 'rpc_error_code',
            message     : e.message
        }
        return formatError
    }

    /* create rpc client over http or https */
    private getClient = (rpcPath: string): xmlrpc.Client => {
        const {host, port} = this.config
        const urlProperty = new URL(String(host))
        const options = {
            host: urlProperty.host,
            port: Number(port),
            path: rpcPath,
        }
        if (urlProperty.protocol === 'http:') {
            this.client = xmlrpc.createClient(options)
        } else {
            this.client = xmlrpc.createSecureClient(options)
        }
        return this.client
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
        rpc.config = config
        return rpc
    }
}

export default OdooXMLRPC