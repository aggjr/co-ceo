/**
 * GenericTreeApi.js - CO-CEO adaptation of CASH's tree API service
 * Provides a generic API client for hierarchical tree data (tipo_entrada, etc.)
 */

export default class GenericTreeApi {
    constructor(tableName) {
        this.tableName = tableName;
        this.baseUrl = `/api/cash/${tableName}`;
    }

    getHeaders() {
        const token = localStorage.getItem('token');
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        };
    }

    getTenantId() {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        return user.tenantId || user.id || null;
    }

    async getAll(params = {}) {
        const tenantId = this.getTenantId();
        const url = new URL(`${window.location.origin}${this.baseUrl}`);
        url.searchParams.set('tenantId', tenantId);
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== null) url.searchParams.set(k, v);
        });

        const res = await fetch(url.toString(), { headers: this.getHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
    }

    async create(data) {
        const tenantId = this.getTenantId();
        const res = await fetch(this.baseUrl, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ ...data, tenantId })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
    }

    async update(id, data) {
        const res = await fetch(`${this.baseUrl}/${id}`, {
            method: 'PUT',
            headers: this.getHeaders(),
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
    }

    async delete(id) {
        const res = await fetch(`${this.baseUrl}/${id}`, {
            method: 'DELETE',
            headers: this.getHeaders()
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
    }

    async move(id, parentId, ordem = 0) {
        const res = await fetch(`${this.baseUrl}/${id}/move`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ parent_id: parentId, ordem })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return res.json();
    }
}
