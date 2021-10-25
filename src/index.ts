import xmlrpc from 'xmlrpc';

class OdooXMLRPC {
    config!: Record<string, unknown>;

    init = (config: Record<string, unknown>): void => {
        this.config = config
    }
}

const odooXMLRPC = new OdooXMLRPC()
export default odooXMLRPC