import DefaultFindProcessor, {
	FindAnnotation,
	FindProcessor,
	FindResult, SearchContext
} from "../common/find";
import EPUBView from "./epub-view";
import SectionView from "./section-view";
import { FindState } from "../../common/types";
import { PersistentRange } from "../common/lib/range";

export class EPUBFindProcessor implements FindProcessor {
	readonly view: EPUBView;

	readonly findState: FindState;

	private _processors: DefaultFindProcessor[] = [];

	private _processorPromises: Promise<DefaultFindProcessor>[] = [];

	private _selectedProcessor: DefaultFindProcessor | null = null;

	private _totalResults = 0;

	private readonly _onSetFindState?: (state?: FindState) => void;

	constructor(options: {
		view: EPUBView,
		findState: FindState,
		onSetFindState?: (state?: FindState) => void,
	}) {
		this.view = options.view;
		this.findState = options.findState;
		this._onSetFindState = options.onSetFindState;
	}

	async run(startRange?: Range | PersistentRange, onFirstResult?: () => void) {
		let startIndex = this.view.flow.startView
			? this.view.views.indexOf(this.view.flow.startView)
			: 0;
		for (let i = startIndex; i < startIndex + this.view.views.length; i++) {
			let view = this.view.views[i % this.view.views.length];
			let processor = await this._getOrCreateProcessor(
				view,
				this._selectedProcessor ? undefined : startRange
			);
			if (this._selectedProcessor === processor) {
				onFirstResult?.();
			}
		}
	}

	async prev(): Promise<FindResult | null> {
		if (this._selectedProcessor) {
			this._selectedProcessor.prev(false);
			this._setFindState();
			if (this._selectedProcessor.current) {
				return this._selectedProcessor.current;
			}
		}
		let nextIndex = this._selectedProcessor ? this._processors.indexOf(this._selectedProcessor) - 1 : -1;
		if (nextIndex < 0) {
			nextIndex += this.view.views.length;
		}
		this._selectedProcessor = await this._getOrCreateProcessor(this.view.views[nextIndex]);
		let stop = this._selectedProcessor;
		do {
			if (this._selectedProcessor.getResults().length) {
				let result = this._selectedProcessor.prev(false);
				this._setFindState();
				return result;
			}

			nextIndex--;
			if (nextIndex < 0) {
				nextIndex += this.view.views.length;
			}
			this._selectedProcessor = await this._getOrCreateProcessor(this.view.views[nextIndex]);
		}
		while (this._selectedProcessor !== stop);

		return null;
	}

	async next(): Promise<FindResult | null> {
		if (this._selectedProcessor) {
			this._selectedProcessor.next(false);
			this._setFindState();
			if (this._selectedProcessor.current) {
				return this._selectedProcessor.current;
			}
		}
		let nextIndex = this._selectedProcessor ? this._processors.indexOf(this._selectedProcessor) + 1 : 0;
		nextIndex %= this.view.views.length;
		if (this._selectedProcessor) this._selectedProcessor.position = null;
		this._selectedProcessor = await this._getOrCreateProcessor(this.view.views[nextIndex]);
		let stop = this._selectedProcessor;
		do {
			if (this._selectedProcessor.getResults().length) {
				let result = this._selectedProcessor.next(false);
				this._setFindState();
				return result;
			}

			nextIndex++;
			nextIndex %= this.view.views.length;
			this._selectedProcessor = await this._getOrCreateProcessor(this.view.views[nextIndex]);
		}
		while (this._selectedProcessor !== stop);

		return null;
	}

	getAnnotations(): FindAnnotation[] {
		let highlights = [];
		for (let [i, processor] of this._processors.entries()) {
			if (!processor || !this.view.views[i]?.mounted) continue;
			processor.findState.highlightAll = this.findState.highlightAll;
			for (let highlight of processor.getAnnotations()) {
				highlights.push(highlight);
			}
		}
		return highlights;
	}

	private _getOrCreateProcessor(view: SectionView, startRange?: Range | PersistentRange): Promise<DefaultFindProcessor> {
		let index = view.section.index;
		if (this._processorPromises[index] !== undefined) {
			return this._processorPromises[index];
		}
		return this._processorPromises[index] = (async () => {
			if (this._processors[index] !== undefined) {
				return this._processors[index];
			}
			let processor = new DefaultFindProcessor({
				findState: this.findState,
				annotationKeyPrefix: 'section' + index,
			});
			await processor.run(
				view.searchContext,
				startRange,
			);
			this._processors[index] = processor;
			if (!this._selectedProcessor && processor.initialPosition !== null) {
				this._selectedProcessor = processor;
			}
			this._totalResults += processor.getResults().length;
			this._setFindState();
			return processor;
		})();
	}

	private _setFindState() {
		if (this._onSetFindState) {
			let index = 0;
			let foundSelected = false;
			let snippets = [];
			for (let processor of this._processors) {
				if (!processor) {
					continue;
				}
				if (this._selectedProcessor == processor) {
					index += processor.position ?? 0;
					foundSelected = true;
				}
				else if (!foundSelected) {
					index += processor.getResults().length;
				}
				snippets.push(...processor.getSnippets());
			}
			this._onSetFindState({
				...this.findState,
				result: {
					total: this._totalResults,
					index,
					snippets,
				}
			});
		}
	}
}
