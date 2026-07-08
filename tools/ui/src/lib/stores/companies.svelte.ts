import { DatabaseService } from '$lib/services/database.service';
import type { DatabaseCompany } from '$lib/types/database';
import { uuid } from '$lib/utils';
import { toast } from 'svelte-sonner';
import { jarvisBackend } from '$lib/services/jarvis-backend.service';
import { personas } from '$lib/services/personas';

class CompaniesStore {
	companies = $state<DatabaseCompany[]>([]);
	activeCompanyId = $state<string | null>(null);
	isInitialized = $state(false);

	private async syncToBackend() {
		try {
			const configs = this.companies.map(c => ({
				id: c.id,
				name: c.name,
				nodes: c.employeeIds.map(eid => {
					const p = personas.find(x => x.id === eid);
					if (!p) return null;
					return {
						id: p.id,
						role: "worker",
						url: "http://127.0.0.1:8080/v1",
						model_name: p.model_name || "llama-model",
						temperature: p.voiceSettings?.pitch || 0.8,
						persona: p.prompt,
						sourceType: "local",
						mcp_servers: p.mcp_servers || []
					};
				}).filter(Boolean)
			}));
			await jarvisBackend.syncSwarmConfig(configs, this.activeCompanyId);
		} catch (e) {
			console.error("Failed to sync swarm configs:", e);
		}
	}

	async initialize() {
		if (this.isInitialized) return;
		try {
			this.companies = await DatabaseService.getAllCompanies();
			
			// Load active company from localStorage if exists
			const savedActive = localStorage.getItem('activeCompanyId');
			if (savedActive && this.companies.some(c => c.id === savedActive)) {
				this.activeCompanyId = savedActive;
			} else if (this.companies.length > 0) {
				this.activeCompanyId = this.companies[0].id;
			}
			
			this.isInitialized = true;
			this.syncToBackend();
		} catch (error) {
			console.error('Failed to initialize companies store:', error);
			toast.error('Failed to load companies');
		}
	}

	async createCompany(name: string, description: string = '', themeColor: string = '#10a37f'): Promise<DatabaseCompany> {
		const newCompany: DatabaseCompany = {
			id: uuid(),
			name,
			description,
			themeColor,
			employeeIds: []
		};
		
		await DatabaseService.createCompany(newCompany);
		this.companies = [...this.companies, newCompany];
		
		if (!this.activeCompanyId) {
			this.setActiveCompany(newCompany.id);
		} else {
			this.syncToBackend();
		}
		
		return newCompany;
	}

	async updateCompany(id: string, updates: Partial<DatabaseCompany>) {
		await DatabaseService.updateCompany(id, updates);
		this.companies = this.companies.map(c => 
			c.id === id ? { ...c, ...updates } : c
		);
		this.syncToBackend();
	}

	async deleteCompany(id: string) {
		await DatabaseService.deleteCompany(id);
		this.companies = this.companies.filter(c => c.id !== id);
		
		if (this.activeCompanyId === id) {
			this.setActiveCompany(this.companies.length > 0 ? this.companies[0].id : null);
		} else {
			this.syncToBackend();
		}
	}

	setActiveCompany(id: string | null) {
		this.activeCompanyId = id;
		if (id) {
			localStorage.setItem('activeCompanyId', id);
		} else {
			localStorage.removeItem('activeCompanyId');
		}
		this.syncToBackend();
	}

	async hireEmployee(companyId: string, employeeId: string) {
		const company = this.companies.find(c => c.id === companyId);
		if (!company) return;
		
		if (!company.employeeIds.includes(employeeId)) {
			const newEmployeeIds = [...company.employeeIds, employeeId];
			await this.updateCompany(companyId, { employeeIds: newEmployeeIds });
		}
	}

	async fireEmployee(companyId: string, employeeId: string) {
		const company = this.companies.find(c => c.id === companyId);
		if (!company) return;
		
		const newEmployeeIds = company.employeeIds.filter(id => id !== employeeId);
		await this.updateCompany(companyId, { employeeIds: newEmployeeIds });
	}

	get activeCompany(): DatabaseCompany | undefined {
		return this.companies.find(c => c.id === this.activeCompanyId);
	}
}

export const companiesStore = new CompaniesStore();
