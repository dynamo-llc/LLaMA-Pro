import { toast } from 'svelte-sonner';

const STARTING_BALANCE = 1000000;

class EconomyStore {
	balance = $state<number>(STARTING_BALANCE);
	isInitialized = $state(false);

	initialize() {
		if (this.isInitialized) return;
		
		try {
			const saved = localStorage.getItem('llamaCoinsBalance');
			if (saved !== null) {
				this.balance = parseInt(saved, 10);
			} else {
				this.balance = STARTING_BALANCE;
				this.save();
			}
			this.isInitialized = true;
		} catch (error) {
			console.error('Failed to initialize economy store:', error);
		}
	}

	private save() {
		try {
			localStorage.setItem('llamaCoinsBalance', this.balance.toString());
		} catch (e) {
			console.error('Failed to save balance to localStorage:', e);
		}
	}

	canAfford(amount: number): boolean {
		return this.balance >= amount;
	}

	spend(amount: number): boolean {
		if (!this.canAfford(amount)) return false;
		
		this.balance -= amount;
		this.save();
		return true;
	}

	earn(amount: number) {
		this.balance += amount;
		this.save();
	}
	
	grantDeveloperFunds() {
		this.earn(1000000);
		toast.success("ðŸ’° Developer Grant: 1,000,000 LLaMA Coins received!");
	}
}

export const economyStore = new EconomyStore();
