/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/tabstitlecontrol';
import { isMacintosh } from 'vs/base/common/platform';
import { shorten } from 'vs/base/common/labels';
import { toResource, GroupIdentifier, IEditorInput, Verbosity, EditorCommandsContextActionRunner, IEditorPartOptions, SideBySideEditor } from 'vs/workbench/common/editor';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { EventType as TouchEventType, GestureEvent, Gesture } from 'vs/base/browser/touch';
import { KeyCode } from 'vs/base/common/keyCodes';
import { ResourceLabels, IResourceLabel, DEFAULT_LABELS_CONTAINER } from 'vs/workbench/browser/labels';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IMenuService } from 'vs/platform/actions/common/actions';
import { TitleControl } from 'vs/workbench/browser/parts/editor/titleControl';
import { IQuickOpenService } from 'vs/platform/quickOpen/common/quickOpen';
import { IDisposable, dispose, DisposableStore, combinedDisposable, MutableDisposable, Disposable } from 'vs/base/common/lifecycle';
import { ScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility, IScrollPosition } from 'vs/base/common/scrollable';
import { getOrSet } from 'vs/base/common/map';
import { IThemeService, registerThemingParticipant, ITheme, ICssStyleCollector, HIGH_CONTRAST } from 'vs/platform/theme/common/themeService';
import { TAB_INACTIVE_BACKGROUND, TAB_ACTIVE_BACKGROUND, TAB_ACTIVE_FOREGROUND, TAB_INACTIVE_FOREGROUND, TAB_BORDER, EDITOR_DRAG_AND_DROP_BACKGROUND, TAB_UNFOCUSED_ACTIVE_FOREGROUND, TAB_UNFOCUSED_INACTIVE_FOREGROUND, TAB_UNFOCUSED_ACTIVE_BACKGROUND, TAB_UNFOCUSED_ACTIVE_BORDER, TAB_ACTIVE_BORDER, TAB_HOVER_BACKGROUND, TAB_HOVER_BORDER, TAB_UNFOCUSED_HOVER_BACKGROUND, TAB_UNFOCUSED_HOVER_BORDER, EDITOR_GROUP_HEADER_TABS_BACKGROUND, WORKBENCH_BACKGROUND, TAB_ACTIVE_BORDER_TOP, TAB_UNFOCUSED_ACTIVE_BORDER_TOP, TAB_ACTIVE_MODIFIED_BORDER, TAB_INACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER } from 'vs/workbench/common/theme';
import { activeContrastBorder, contrastBorder, editorBackground, breadcrumbsBackground } from 'vs/platform/theme/common/colorRegistry';
import { ResourcesDropHandler, fillResourceDataTransfers, DraggedEditorIdentifier, DraggedEditorGroupIdentifier, DragAndDropObserver } from 'vs/workbench/browser/dnd';
import { Color } from 'vs/base/common/color';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { MergeGroupMode, IMergeGroupOptions } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IUntitledEditorService } from 'vs/workbench/services/untitled/common/untitledEditorService';
import { addClass, addDisposableListener, hasClass, EventType, EventHelper, removeClass, Dimension, scheduleAtNextAnimationFrame, findParentWithClass, clearNode } from 'vs/base/browser/dom';
import { localize } from 'vs/nls';
import { IEditorGroupsAccessor, IEditorGroupView } from 'vs/workbench/browser/parts/editor/editor';
import { CloseOneEditorAction, HardPinOneEditorAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { BreadcrumbsControl } from 'vs/workbench/browser/parts/editor/breadcrumbsControl';
import { IFileService } from 'vs/platform/files/common/files';
import { withNullAsUndefined, assertAllDefined, assertIsDefined } from 'vs/base/common/types';
import { ILabelService } from 'vs/platform/label/common/label';
import { TabsTitleControl } from 'vs/workbench/browser/parts/editor/tabsTitleControl';

interface IEditorInputLabel {
	name?: string;
	description?: string;
	title?: string;
}

type AugmentedLabel = IEditorInputLabel & { editor: IEditorInput };

export class TabsEditorControl extends Disposable {

	private group: IEditorGroupView;
	private accessor: IEditorGroupsAccessor;
	private titleContainer: HTMLElement | undefined;
	private tabsContainer: HTMLElement | undefined;
	private tabsScrollbar: ScrollableElement | undefined;

	private closeOneEditorAction: CloseOneEditorAction;
	private hardPinOneEditorAction: HardPinOneEditorAction;

	private tabResourceLabels: ResourceLabels;
	private tabLabels: IEditorInputLabel[] = [];
	private tabDisposables: IDisposable[] = [];
	private dimension: Dimension | undefined;

	private layoutScheduled = this._register(new MutableDisposable());
	private blockRevealActiveTab: boolean | undefined;

	constructor(private tabsTitleControl: TabsTitleControl) {
		super();

		this.group = tabsTitleControl.getGroup();
		this.accessor = tabsTitleControl.getAccessor();
		this.tabResourceLabels = this._register(tabsTitleControl.getInstationService().createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
		this.closeOneEditorAction = this._register(tabsTitleControl.getInstationService().createInstance(CloseOneEditorAction, CloseOneEditorAction.ID, CloseOneEditorAction.LABEL));
		this.hardPinOneEditorAction = this._register(tabsTitleControl.getInstationService().createInstance(HardPinOneEditorAction, HardPinOneEditorAction.ID, HardPinOneEditorAction.LABEL));
	}

	protected create(parent: HTMLElement): void {
		this.titleContainer = parent;

		// Tabs Container
		this.tabsContainer = document.createElement('div');
		this.tabsContainer.setAttribute('role', 'tablist');
		this.tabsContainer.draggable = true;
		addClass(this.tabsContainer, 'tabs-container');


		// Tabs Scrollbar
		this.tabsScrollbar = this._register(this.createTabsScrollbar(this.tabsContainer));
		this.titleContainer.appendChild(this.tabsScrollbar.getDomNode());

		// Tabs Container listeners
		this.tabsTitleControl.registerTabsContainerListeners(this.tabsContainer, this.tabsScrollbar, this);
	}

	private createTabsScrollbar(scrollable: HTMLElement): ScrollableElement {
		const tabsScrollbar = new ScrollableElement(scrollable, {
			horizontal: ScrollbarVisibility.Auto,
			vertical: ScrollbarVisibility.Hidden,
			scrollYToX: true,
			useShadows: false,
			horizontalScrollbarSize: 3
		});

		tabsScrollbar.onScroll(e => {
			scrollable.scrollLeft = e.scrollLeft;
		});

		return tabsScrollbar;
	}


	public handleBreadcrumbsEnablementChange(): void {
		// relayout when breadcrumbs are enable/disabled
		this.group.relayout();
	}



	openEditor(editor: IEditorInput): void {

		// Create tabs as needed
		const [tabsContainer, tabsScrollbar] = assertAllDefined(this.tabsContainer, this.tabsScrollbar);
		for (let i = tabsContainer.children.length; i < this.group.count; i++) {
			tabsContainer.appendChild(this.createTab(i, tabsContainer, tabsScrollbar));
		}

		// An add of a tab requires to recompute all labels
		this.computeTabLabels();

		// Redraw all tabs
		this.redraw();
	}

	closeEditor(editor: IEditorInput): void {
		editor.isHardPinned();
		this.handleClosedEditors();
	}

	closeEditors(editors: IEditorInput[]): void {
		this.handleClosedEditors();
	}

	closeAllEditors(): void {
		this.handleClosedEditors();
	}

	private handleClosedEditors(): void {

		// There are tabs to show
		if (this.group.activeEditor) {

			// Remove tabs that got closed
			const tabsContainer = assertIsDefined(this.tabsContainer);
			while (tabsContainer.children.length > this.group.count) {

				// Remove one tab from container (must be the last to keep indexes in order!)
				(tabsContainer.lastChild as HTMLElement).remove();

				// Remove associated tab label and widget
				this.tabDisposables.pop()!.dispose();
			}

			// A removal of a label requires to recompute all labels
			this.computeTabLabels();

			// Redraw all tabs
			this.redraw();
		}

		// No tabs to show
		else {
			if (this.tabsContainer) {
				clearNode(this.tabsContainer);
			}

			this.tabDisposables = dispose(this.tabDisposables);
			this.tabResourceLabels.clear();
			this.tabLabels = [];

			//this.tabsTitleControl.clearEditorActionsToolbar();
		}

	}

	moveEditor(editor: IEditorInput, fromIndex: number, targetIndex: number): void {

		// Swap the editor label
		const editorLabel = this.tabLabels[fromIndex];
		this.tabLabels.splice(fromIndex, 1);
		this.tabLabels.splice(targetIndex, 0, editorLabel);

		this.redraw();
	}

	pinEditor(editor: IEditorInput): void {
		this.withTab(editor, (tabContainer, tabLabelWidget, tabLabel) => this.redrawLabel(editor, tabContainer, tabLabelWidget, tabLabel));
	}

	hardPinEditor(editor: IEditorInput): void {
		var tbs = assertIsDefined(this.tabsScrollbar);
		var os = tbs.getScrollPosition();
		this.redraw();
		tbs.setScrollPosition(os);
	}

	setActive(isGroupActive: boolean): void {

		// Activity has an impact on each tab
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel) => {
			this.redrawEditorActiveAndDirty(isGroupActive, editor, tabContainer, tabLabelWidget);
		});
	}

	updateEditorLabel(editor: IEditorInput): void {

		// Update all labels to account for changes to tab labels
		this.updateEditorLabels();
	}

	updateEditorLabels(): void {

		// A change to a label requires to recompute all labels
		this.computeTabLabels();

		// As such we need to redraw each label
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel) => {
			this.redrawLabel(editor, tabContainer, tabLabelWidget, tabLabel);
		});

	}

	updateEditorDirty(editor: IEditorInput): void {
		this.withTab(editor, (tabContainer, tabLabelWidget) => this.redrawEditorActiveAndDirty(this.accessor.activeGroup === this.group, editor, tabContainer, tabLabelWidget));
	}

	updateOptions(oldOptions: IEditorPartOptions, newOptions: IEditorPartOptions): void {

		// A change to a label format options requires to recompute all labels
		if (oldOptions.labelFormat !== newOptions.labelFormat) {
			this.computeTabLabels();
		}

		// Apply new options if something of interest changed
		if (
			oldOptions.labelFormat !== newOptions.labelFormat ||
			oldOptions.tabCloseButton !== newOptions.tabCloseButton ||
			oldOptions.tabSizing !== newOptions.tabSizing ||
			oldOptions.showIcons !== newOptions.showIcons ||
			oldOptions.iconTheme !== newOptions.iconTheme ||
			oldOptions.highlightModifiedTabs !== newOptions.highlightModifiedTabs
		) {
			this.redraw();
		}
	}

	updateStyles(): void {
		this.redraw();
	}

	private withTab(editor: IEditorInput, fn: (tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel) => void): void {
		const editorIndex = this.group.getIndexOfEditor(editor);

		const tabsContainer = assertIsDefined(this.tabsContainer);
		const tabContainer = tabsContainer.children[editorIndex] as HTMLElement;
		if (tabContainer) {
			fn(tabContainer, this.tabResourceLabels.get(editorIndex), this.tabLabels[editorIndex]);
		}
	}

	private createTab(index: number, tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): HTMLElement {

		// Tab Container
		const tabContainer = document.createElement('div');
		tabContainer.draggable = true;
		tabContainer.tabIndex = index;
		tabContainer.setAttribute('role', 'presentation'); // cannot use role "tab" here due to https://github.com/Microsoft/vscode/issues/8659
		addClass(tabContainer, 'tab');

		// Gesture Support
		this._register(Gesture.addTarget(tabContainer));

		// Tab Border Top
		const tabBorderTopContainer = document.createElement('div');
		addClass(tabBorderTopContainer, 'tab-border-top-container');
		tabContainer.appendChild(tabBorderTopContainer);

		// Tab Editor Label
		const editorLabel = this.tabResourceLabels.create(tabContainer);

		// ----------------------------------------------------------------------
		const tabHardPinContainer = document.createElement('div');
		addClass(tabHardPinContainer, 'tab-close');
		tabContainer.appendChild(tabHardPinContainer);
		// ----------------------------------------------------------------------

		// Tab Close Button
		const tabCloseContainer = document.createElement('div');
		addClass(tabCloseContainer, 'tab-close');
		tabContainer.appendChild(tabCloseContainer);

		// Tab Border Bottom
		const tabBorderBottomContainer = document.createElement('div');
		addClass(tabBorderBottomContainer, 'tab-border-bottom-container');
		tabContainer.appendChild(tabBorderBottomContainer);

		const tabActionRunner = new EditorCommandsContextActionRunner({ groupId: this.group.id, editorIndex: index });

		const tabActionBar = new ActionBar(tabCloseContainer, { ariaLabel: localize('araLabelTabActions', "Tab actions"), actionRunner: tabActionRunner });
		tabActionBar.push(this.closeOneEditorAction, { icon: true, label: false, keybinding: this.tabsTitleControl.getKeybindingLabel(this.closeOneEditorAction) });
		tabActionBar.onDidBeforeRun(() => this.blockRevealActiveTabOnce());

		const tabHardPinnedActionBar = new ActionBar(tabHardPinContainer, { ariaLabel: localize('araLabelTabActions', "Tab actions"), actionRunner: tabActionRunner });
		tabHardPinnedActionBar.push(this.hardPinOneEditorAction, { icon: true, label: false, keybinding: this.tabsTitleControl.getKeybindingLabel(this.hardPinOneEditorAction) });
		tabHardPinnedActionBar.onDidBeforeRun(() => this.blockRevealActiveTabOnce());

		// Eventing
		const eventsDisposable = this.registerTabListeners(tabContainer, index, tabsContainer, tabsScrollbar);

		this.tabDisposables.push(combinedDisposable(eventsDisposable, tabActionBar, tabHardPinnedActionBar, tabActionRunner, editorLabel));

		return tabContainer;
	}

	private registerTabListeners(tab: HTMLElement, index: number, tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): IDisposable {
		const disposables = new DisposableStore();

		const handleClickOrTouch = (e: MouseEvent | GestureEvent): void => {
			tab.blur();

			if (e instanceof MouseEvent && e.button !== 0) {
				if (e.button === 1) {
					e.preventDefault(); // required to prevent auto-scrolling (https://github.com/Microsoft/vscode/issues/16690)
				}

				return undefined; // only for left mouse click
			}

			if (this.originatesFromTabActionBar(e)) {
				return; // not when clicking on actions
			}

			// Open tabs editor
			const input = this.group.getEditor(index);
			if (input) {
				this.group.openEditor(input);
			}

			return undefined;
		};

		const showContextMenu = (e: Event) => {
			EventHelper.stop(e);

			const input = this.group.getEditor(index);
			if (input) {
				this.tabsTitleControl.onContextMenu(input, e, tab);
			}
		};

		// Open on Click / Touch
		disposables.add(addDisposableListener(tab, EventType.MOUSE_DOWN, (e: MouseEvent) => handleClickOrTouch(e)));
		disposables.add(addDisposableListener(tab, TouchEventType.Tap, (e: GestureEvent) => handleClickOrTouch(e)));

		// Touch Scroll Support
		disposables.add(addDisposableListener(tab, TouchEventType.Change, (e: GestureEvent) => {
			tabsScrollbar.setScrollPosition({ scrollLeft: tabsScrollbar.getScrollPosition().scrollLeft - e.translationX });
		}));

		// Close on mouse middle click
		disposables.add(addDisposableListener(tab, EventType.MOUSE_UP, (e: MouseEvent) => {
			EventHelper.stop(e);

			tab.blur();

			if (e.button === 1 /* Middle Button*/) {
				e.stopPropagation(); // for https://github.com/Microsoft/vscode/issues/56715

				this.blockRevealActiveTabOnce();
				this.closeOneEditorAction.run({ groupId: this.group.id, editorIndex: index });
			}
		}));

		// Context menu on Shift+F10
		disposables.add(addDisposableListener(tab, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.shiftKey && event.keyCode === KeyCode.F10) {
				showContextMenu(e);
			}
		}));

		// Context menu on touch context menu gesture
		disposables.add(addDisposableListener(tab, TouchEventType.Contextmenu, (e: GestureEvent) => {
			showContextMenu(e);
		}));

		// Keyboard accessibility
		disposables.add(addDisposableListener(tab, EventType.KEY_UP, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			let handled = false;

			// Run action on Enter/Space
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				handled = true;
				const input = this.group.getEditor(index);
				if (input) {
					this.group.openEditor(input);
				}
			}

			// Navigate in editors
			else if ([KeyCode.LeftArrow, KeyCode.RightArrow, KeyCode.UpArrow, KeyCode.DownArrow, KeyCode.Home, KeyCode.End].some(kb => event.equals(kb))) {
				let targetIndex: number;
				if (event.equals(KeyCode.LeftArrow) || event.equals(KeyCode.UpArrow)) {
					targetIndex = index - 1;
				} else if (event.equals(KeyCode.RightArrow) || event.equals(KeyCode.DownArrow)) {
					targetIndex = index + 1;
				} else if (event.equals(KeyCode.Home)) {
					targetIndex = 0;
				} else {
					targetIndex = this.group.count - 1;
				}

				const target = this.group.getEditor(targetIndex);
				if (target) {
					handled = true;
					this.group.openEditor(target, { preserveFocus: true });
					(<HTMLElement> tabsContainer.childNodes[targetIndex]).focus();
				}
			}

			if (handled) {
				EventHelper.stop(e, true);
			}

			// moving in the tabs container can have an impact on scrolling position, so we need to update the custom scrollbar
			tabsScrollbar.setScrollPosition({
				scrollLeft: tabsContainer.scrollLeft
			});
		}));

		// Pin on double click
		disposables.add(addDisposableListener(tab, EventType.DBLCLICK, (e: MouseEvent) => {
			EventHelper.stop(e);

			this.group.pinEditor(this.group.getEditor(index) || undefined);
		}));

		// Context menu
		disposables.add(addDisposableListener(tab, EventType.CONTEXT_MENU, (e: Event) => {
			EventHelper.stop(e, true);

			const input = this.group.getEditor(index);
			if (input) {
				this.tabsTitleControl.onContextMenu(input, e, tab);
			}
		}, true /* use capture to fix https://github.com/Microsoft/vscode/issues/19145 */));

		// Drag support
		disposables.add(addDisposableListener(tab, EventType.DRAG_START, (e: DragEvent) => {
			const editor = this.group.getEditor(index);
			if (!editor) {
				return;
			}

			this.tabsTitleControl.editorTransfer.setData([new DraggedEditorIdentifier({ editor, groupId: this.group.id })], DraggedEditorIdentifier.prototype);

			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'copyMove';
			}

			// Apply some datatransfer types to allow for dragging the element outside of the application
			const resource = toResource(editor, { supportSideBySide: SideBySideEditor.MASTER });
			if (resource) {
				this.tabsTitleControl.getInstationService().invokeFunction(fillResourceDataTransfers, [resource], e);
			}

			// Fixes https://github.com/Microsoft/vscode/issues/18733
			addClass(tab, 'dragged');
			scheduleAtNextAnimationFrame(() => removeClass(tab, 'dragged'));
		}));

		// Drop support
		disposables.add(new DragAndDropObserver(tab, {
			onDragEnter: e => {

				// Update class to signal drag operation
				addClass(tab, 'dragged-over');

				// Return if transfer is unsupported
				if (!this.isSupportedDropTransfer(e)) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'none';
					}

					return;
				}

				// Return if dragged editor is the current tab dragged over
				let isLocalDragAndDrop = false;
				if (this.tabsTitleControl.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
					isLocalDragAndDrop = true;

					const data = this.tabsTitleControl.editorTransfer.getData(DraggedEditorIdentifier.prototype);
					if (Array.isArray(data)) {
						const localDraggedEditor = data[0].identifier;
						if (localDraggedEditor.editor === this.group.getEditor(index) && localDraggedEditor.groupId === this.group.id) {
							if (e.dataTransfer) {
								e.dataTransfer.dropEffect = 'none';
							}

							return;
						}
					}
				}

				// Update the dropEffect to "copy" if there is no local data to be dragged because
				// in that case we can only copy the data into and not move it from its source
				if (!isLocalDragAndDrop) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'copy';
					}
				}

				this.updateDropFeedback(tab, true, index);
			},

			onDragLeave: e => {
				removeClass(tab, 'dragged-over');
				this.updateDropFeedback(tab, false, index);
			},

			onDragEnd: e => {
				removeClass(tab, 'dragged-over');
				this.updateDropFeedback(tab, false, index);

				this.tabsTitleControl.editorTransfer.clearData(DraggedEditorIdentifier.prototype);
			},

			onDrop: e => {
				removeClass(tab, 'dragged-over');
				this.updateDropFeedback(tab, false, index);

				this.onDrop(e, index, tabsContainer);
			}
		}));

		return disposables;
	}

	public isSupportedDropTransfer(e: DragEvent): boolean {
		if (this.tabsTitleControl.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			const data = this.tabsTitleControl.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
			if (Array.isArray(data)) {
				const group = data[0];
				if (group.identifier === this.group.id) {
					return false; // groups cannot be dropped on title area it originates from
				}
			}

			return true;
		}

		if (this.tabsTitleControl.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
			return true; // (local) editors can always be dropped
		}

		if (e.dataTransfer && e.dataTransfer.types.length > 0) {
			return true; // optimistically allow external data (// see https://github.com/Microsoft/vscode/issues/25789)
		}

		return false;
	}

	public updateDropFeedback(element: HTMLElement, isDND: boolean, index?: number): void {
		const isTab = (typeof index === 'number');
		const editor = typeof index === 'number' ? this.group.getEditor(index) : undefined;
		const isActiveTab = isTab && !!editor && this.group.isActive(editor);

		// Background
		const noDNDBackgroundColor = isTab ? this.tabsTitleControl.getColor(isActiveTab ? TAB_ACTIVE_BACKGROUND : TAB_INACTIVE_BACKGROUND) : '';
		element.style.backgroundColor = (isDND ? this.tabsTitleControl.getColor(EDITOR_DRAG_AND_DROP_BACKGROUND) : noDNDBackgroundColor) || '';

		// Outline
		const activeContrastBorderColor = this.tabsTitleControl.getColor(activeContrastBorder);
		if (activeContrastBorderColor && isDND) {
			element.style.outlineWidth = '2px';
			element.style.outlineStyle = 'dashed';
			element.style.outlineColor = activeContrastBorderColor;
			element.style.outlineOffset = isTab ? '-5px' : '-3px';
		} else {
			element.style.outlineWidth = '';
			element.style.outlineStyle = '';
			element.style.outlineColor = activeContrastBorderColor || '';
			element.style.outlineOffset = '';
		}
	}

	private computeTabLabels(): void {
		const { labelFormat } = this.accessor.partOptions;
		const { verbosity, shortenDuplicates } = this.getLabelConfigFlags(labelFormat);

		// Build labels and descriptions for each editor
		const labels = this.group.editors.map(editor => ({
			editor,
			name: editor.getName(),
			description: editor.getDescription(verbosity),
			title: withNullAsUndefined(editor.getTitle(Verbosity.LONG))
		}));

		// Shorten labels as needed
		if (shortenDuplicates) {
			this.shortenTabLabels(labels);
		}

		this.tabLabels = labels;
	}

	private shortenTabLabels(labels: AugmentedLabel[]): void {

		// Gather duplicate titles, while filtering out invalid descriptions
		const mapTitleToDuplicates = new Map<string, AugmentedLabel[]>();
		for (const label of labels) {
			if (typeof label.description === 'string') {
				getOrSet(mapTitleToDuplicates, label.name, []).push(label);
			} else {
				label.description = '';
			}
		}

		// Identify duplicate titles and shorten descriptions
		mapTitleToDuplicates.forEach(duplicateTitles => {

			// Remove description if the title isn't duplicated
			if (duplicateTitles.length === 1) {
				duplicateTitles[0].description = '';

				return;
			}

			// Identify duplicate descriptions
			const mapDescriptionToDuplicates = new Map<string, AugmentedLabel[]>();
			for (const label of duplicateTitles) {
				getOrSet(mapDescriptionToDuplicates, label.description, []).push(label);
			}

			// For editors with duplicate descriptions, check whether any long descriptions differ
			let useLongDescriptions = false;
			mapDescriptionToDuplicates.forEach((duplicateDescriptions, name) => {
				if (!useLongDescriptions && duplicateDescriptions.length > 1) {
					const [first, ...rest] = duplicateDescriptions.map(({ editor }) => editor.getDescription(Verbosity.LONG));
					useLongDescriptions = rest.some(description => description !== first);
				}
			});

			// If so, replace all descriptions with long descriptions
			if (useLongDescriptions) {
				mapDescriptionToDuplicates.clear();
				duplicateTitles.forEach(label => {
					label.description = label.editor.getDescription(Verbosity.LONG);
					getOrSet(mapDescriptionToDuplicates, label.description, []).push(label);
				});
			}

			// Obtain final set of descriptions
			const descriptions: string[] = [];
			mapDescriptionToDuplicates.forEach((_, description) => descriptions.push(description));

			// Remove description if all descriptions are identical
			if (descriptions.length === 1) {
				for (const label of mapDescriptionToDuplicates.get(descriptions[0]) || []) {
					label.description = '';
				}

				return;
			}

			// Shorten descriptions
			const shortenedDescriptions = shorten(descriptions);
			descriptions.forEach((description, i) => {
				for (const label of mapDescriptionToDuplicates.get(description) || []) {
					label.description = shortenedDescriptions[i];
				}
			});
		});
	}

	private getLabelConfigFlags(value: string | undefined) {
		switch (value) {
			case 'short':
				return { verbosity: Verbosity.SHORT, shortenDuplicates: false };
			case 'medium':
				return { verbosity: Verbosity.MEDIUM, shortenDuplicates: false };
			case 'long':
				return { verbosity: Verbosity.LONG, shortenDuplicates: false };
			default:
				return { verbosity: Verbosity.MEDIUM, shortenDuplicates: true };
		}
	}

	private redraw(): void {

		let hardPinnedCumulativeWidth = 0.0;
		let notHardPinnedCumulativeWidth = 0.0;

		// For each tab
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel) => {
			if (editor.isHardPinned()) {
				this.redrawTab(editor, index, tabContainer, tabLabelWidget, tabLabel, hardPinnedCumulativeWidth);
				hardPinnedCumulativeWidth += tabContainer.offsetWidth;

			} else {
				this.redrawTab(editor, index, tabContainer, tabLabelWidget, tabLabel, 0);
				notHardPinnedCumulativeWidth += tabContainer.offsetWidth;
			}
		});

		// Update Editor Actions Toolbar
		this.tabsTitleControl.updateEditorActionsToolbar();

	}

	private forEachTab(fn: (editor: IEditorInput, index: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel) => void): void {
		this.group.editors.forEach((editor, index) => {
			const tabsContainer = assertIsDefined(this.tabsContainer);
			const tabContainer = tabsContainer.children[index] as HTMLElement;
			if (tabContainer) {
				fn(editor, index, tabContainer, this.tabResourceLabels.get(index), this.tabLabels[index]);
			}
		});
	}

	private redrawTab(editor: IEditorInput, index: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, marginLeft: number = 0): void {

		// Label
		this.redrawLabel(editor, tabContainer, tabLabelWidget, tabLabel);

		// Borders / Outline
		const borderRightColor = (this.tabsTitleControl.getColor(TAB_BORDER) || this.tabsTitleControl.getColor(contrastBorder));
		tabContainer.style.borderRight = borderRightColor ? `1px solid ${borderRightColor}` : '';
		tabContainer.style.outlineColor = this.tabsTitleControl.getColor(activeContrastBorder) || '';
		tabContainer.style.marginLeft = marginLeft + 'px';

		// Settings
		const options = this.accessor.partOptions;

		['off', 'left', 'right'].forEach(option => {
			const domAction = options.tabCloseButton === option ? addClass : removeClass;
			domAction(tabContainer, `close-button-${option}`);
		});

		['fit', 'shrink'].forEach(option => {
			const domAction = options.tabSizing === option ? addClass : removeClass;
			domAction(tabContainer, `sizing-${option}`);
		});

		if (options.showIcons && !!options.iconTheme) {
			addClass(tabContainer, 'has-icon-theme');
		} else {
			removeClass(tabContainer, 'has-icon-theme');
		}

		if (editor.isHardPinned()) {
			addClass(tabContainer, 'pinned');
		} else {
			removeClass(tabContainer, 'pinned');
		}



		// Active / dirty state
		this.redrawEditorActiveAndDirty(this.accessor.activeGroup === this.group, editor, tabContainer, tabLabelWidget);
	}

	private redrawLabel(editor: IEditorInput, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel): void {
		const name = tabLabel.name;
		const description = tabLabel.description || '';
		const title = tabLabel.title || '';

		// Container
		tabContainer.setAttribute('aria-label', `${name}, tab`);
		tabContainer.title = title;

		// Label
		tabLabelWidget.setResource({ name, description, resource: toResource(editor, { supportSideBySide: SideBySideEditor.MASTER }) || undefined }, { title, extraClasses: ['tab-label'], italic: !this.group.isPinned(editor) });
	}

	private redrawEditorActiveAndDirty(isGroupActive: boolean, editor: IEditorInput, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel): void {
		const isTabActive = this.group.isActive(editor);

		const hasModifiedBorderTop = this.doRedrawEditorDirty(isGroupActive, isTabActive, editor, tabContainer);

		this.doRedrawEditorActive(isGroupActive, !hasModifiedBorderTop, editor, tabContainer, tabLabelWidget);
	}

	private doRedrawEditorActive(isGroupActive: boolean, allowBorderTop: boolean, editor: IEditorInput, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel): void {

		// Tab is active
		if (this.group.isActive(editor)) {

			// Container
			addClass(tabContainer, 'active');
			tabContainer.setAttribute('aria-selected', 'true');
			tabContainer.style.backgroundColor = this.tabsTitleControl.getColor(isGroupActive ? TAB_ACTIVE_BACKGROUND : TAB_UNFOCUSED_ACTIVE_BACKGROUND) || '';

			const activeTabBorderColorBottom = this.tabsTitleControl.getColor(isGroupActive ? TAB_ACTIVE_BORDER : TAB_UNFOCUSED_ACTIVE_BORDER);
			if (activeTabBorderColorBottom) {
				addClass(tabContainer, 'tab-border-bottom');
				tabContainer.style.setProperty('--tab-border-bottom-color', activeTabBorderColorBottom.toString());
			} else {
				removeClass(tabContainer, 'tab-border-bottom');
				tabContainer.style.removeProperty('--tab-border-bottom-color');
			}

			const activeTabBorderColorTop = allowBorderTop ? this.tabsTitleControl.getColor(isGroupActive ? TAB_ACTIVE_BORDER_TOP : TAB_UNFOCUSED_ACTIVE_BORDER_TOP) : undefined;
			if (activeTabBorderColorTop) {
				addClass(tabContainer, 'tab-border-top');
				tabContainer.style.setProperty('--tab-border-top-color', activeTabBorderColorTop.toString());
			} else {
				removeClass(tabContainer, 'tab-border-top');
				tabContainer.style.removeProperty('--tab-border-top-color');
			}

			// Label
			tabLabelWidget.element.style.color = this.tabsTitleControl.getColor(isGroupActive ? TAB_ACTIVE_FOREGROUND : TAB_UNFOCUSED_ACTIVE_FOREGROUND);
		}

		// Tab is inactive
		else {

			// Container
			removeClass(tabContainer, 'active');
			tabContainer.setAttribute('aria-selected', 'false');
			tabContainer.style.backgroundColor = this.tabsTitleControl.getColor(TAB_INACTIVE_BACKGROUND) || '';
			tabContainer.style.boxShadow = '';

			// Label
			tabLabelWidget.element.style.color = this.tabsTitleControl.getColor(isGroupActive ? TAB_INACTIVE_FOREGROUND : TAB_UNFOCUSED_INACTIVE_FOREGROUND);
		}
	}

	private doRedrawEditorDirty(isGroupActive: boolean, isTabActive: boolean, editor: IEditorInput, tabContainer: HTMLElement): boolean {
		let hasModifiedBorderColor = false;

		// Tab: dirty
		if (editor.isDirty()) {
			addClass(tabContainer, 'dirty');

			// Highlight modified tabs with a border if configured
			if (this.accessor.partOptions.highlightModifiedTabs) {
				let modifiedBorderColor: string | null;
				if (isGroupActive && isTabActive) {
					modifiedBorderColor = this.tabsTitleControl.getColor(TAB_ACTIVE_MODIFIED_BORDER);
				} else if (isGroupActive && !isTabActive) {
					modifiedBorderColor = this.tabsTitleControl.getColor(TAB_INACTIVE_MODIFIED_BORDER);
				} else if (!isGroupActive && isTabActive) {
					modifiedBorderColor = this.tabsTitleControl.getColor(TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER);
				} else {
					modifiedBorderColor = this.tabsTitleControl.getColor(TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER);
				}

				if (modifiedBorderColor) {
					hasModifiedBorderColor = true;

					addClass(tabContainer, 'dirty-border-top');
					tabContainer.style.setProperty('--tab-dirty-border-top-color', modifiedBorderColor);
				}
			} else {
				removeClass(tabContainer, 'dirty-border-top');
				tabContainer.style.removeProperty('--tab-dirty-border-top-color');
			}
		}

		// Tab: not dirty
		else {
			removeClass(tabContainer, 'dirty');

			removeClass(tabContainer, 'dirty-border-top');
			tabContainer.style.removeProperty('--tab-dirty-border-top-color');
		}

		return hasModifiedBorderColor;
	}

	layout(dimension: Dimension | undefined): void {
		this.dimension = dimension;

		const activeTab = this.group.activeEditor ? this.getTab(this.group.activeEditor) : undefined;
		if (!activeTab || !this.dimension) {
			return;
		}

		// The layout of tabs can be an expensive operation because we access DOM properties
		// that can result in the browser doing a full page layout to validate them. To buffer
		// this a little bit we try at least to schedule this work on the next animation frame.
		if (!this.layoutScheduled.value) {
			this.layoutScheduled.value = scheduleAtNextAnimationFrame(() => {
				const dimension = assertIsDefined(this.dimension);
				this.doLayout(dimension);

				this.layoutScheduled.clear();
			});
		}
	}

	private doLayout(dimension: Dimension): void {
		const activeTab = this.group.activeEditor ? this.getTab(this.group.activeEditor) : undefined;
		if (!activeTab) {
			return;
		}

		const [tabsContainer, tabsScrollbar] = assertAllDefined(this.tabsContainer, this.tabsScrollbar);

		if (this.tabsTitleControl.breadcrumbsControl && !this.tabsTitleControl.breadcrumbsControl.isHidden()) {
			this.tabsTitleControl.breadcrumbsControl.layout({ width: dimension.width, height: BreadcrumbsControl.HEIGHT });
			tabsScrollbar.getDomNode().style.height = `${dimension.height - BreadcrumbsControl.HEIGHT}px`;
		}

		const visibleContainerWidth = tabsContainer.offsetWidth;
		const totalContainerWidth = tabsContainer.scrollWidth;

		let activeTabPosX: number | undefined;
		let activeTabWidth: number | undefined;

		if (!this.blockRevealActiveTab) {
			activeTabPosX = activeTab.offsetLeft;
			activeTabWidth = activeTab.offsetWidth;
		}

		// Update scrollbar
		tabsScrollbar.setScrollDimensions({
			width: visibleContainerWidth,
			scrollWidth: totalContainerWidth
		});

		// Return now if we are blocked to reveal the active tab and clear flag
		if (this.blockRevealActiveTab || typeof activeTabPosX !== 'number' || typeof activeTabWidth !== 'number') {
			this.blockRevealActiveTab = false;
			return;
		}

		// Reveal the active one
		const containerScrollPosX = tabsScrollbar.getScrollPosition().scrollLeft;
		const activeTabFits = activeTabWidth <= visibleContainerWidth;

		// Tab is overflowing to the right: Scroll minimally until the element is fully visible to the right
		// Note: only try to do this if we actually have enough width to give to show the tab fully!
		if (activeTabFits && containerScrollPosX + visibleContainerWidth < activeTabPosX + activeTabWidth) {
			tabsScrollbar.setScrollPosition({
				scrollLeft: containerScrollPosX + ((activeTabPosX + activeTabWidth) /* right corner of tab */ - (containerScrollPosX + visibleContainerWidth) /* right corner of view port */)
			});
		}

		// Tab is overlflowng to the left or does not fit: Scroll it into view to the left
		else if (containerScrollPosX > activeTabPosX || !activeTabFits) {
			tabsScrollbar.setScrollPosition({
				scrollLeft: activeTabPosX
			});
		}
	}

	private getTab(editor: IEditorInput): HTMLElement | undefined {
		const editorIndex = this.group.getIndexOfEditor(editor);
		if (editorIndex >= 0) {
			const tabsContainer = assertIsDefined(this.tabsContainer);

			return tabsContainer.children[editorIndex] as HTMLElement;
		}

		return undefined;
	}

	private blockRevealActiveTabOnce(): void {

		// When closing tabs through the tab close button or gesture, the user
		// might want to rapidly close tabs in sequence and as such revealing
		// the active tab after each close would be annoying. As such we block
		// the automated revealing of the active tab once after the close is
		// triggered.
		this.blockRevealActiveTab = true;
	}

	private originatesFromTabActionBar(e: MouseEvent | GestureEvent): boolean {
		let element: HTMLElement;
		if (e instanceof MouseEvent) {
			element = (e.target || e.srcElement) as HTMLElement;
		} else {
			element = (e as GestureEvent).initialTarget as HTMLElement;
		}

		return !!findParentWithClass(element, 'action-item', 'tab');
	}

	public onDrop(e: DragEvent, targetIndex: number, tabsContainer: HTMLElement): void {
		EventHelper.stop(e, true);

		this.updateDropFeedback(tabsContainer, false);
		removeClass(tabsContainer, 'scroll');

		// Local Editor DND
		if (this.tabsTitleControl.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
			const data = this.tabsTitleControl.editorTransfer.getData(DraggedEditorIdentifier.prototype);
			if (Array.isArray(data)) {
				const draggedEditor = data[0].identifier;
				const sourceGroup = this.accessor.getGroup(draggedEditor.groupId);

				if (sourceGroup) {

					// Move editor to target position and index
					if (this.isMoveOperation(e, draggedEditor.groupId)) {
						sourceGroup.moveEditor(draggedEditor.editor, this.group, { index: targetIndex });
					}

					// Copy editor to target position and index
					else {
						sourceGroup.copyEditor(draggedEditor.editor, this.group, { index: targetIndex });
					}
				}

				this.group.focus();
				this.tabsTitleControl.editorTransfer.clearData(DraggedEditorIdentifier.prototype);
			}
		}

		// Local Editor Group DND
		else if (this.tabsTitleControl.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			const data = this.tabsTitleControl.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
			if (data) {
				const sourceGroup = this.accessor.getGroup(data[0].identifier);

				if (sourceGroup) {
					const mergeGroupOptions: IMergeGroupOptions = { index: targetIndex };
					if (!this.isMoveOperation(e, sourceGroup.id)) {
						mergeGroupOptions.mode = MergeGroupMode.COPY_EDITORS;
					}

					this.accessor.mergeGroup(sourceGroup, this.group, mergeGroupOptions);
				}

				this.group.focus();
				this.tabsTitleControl.groupTransfer.clearData(DraggedEditorGroupIdentifier.prototype);
			}
		}

		// External DND
		else {
			const dropHandler = this.tabsTitleControl.getInstationService().createInstance(ResourcesDropHandler, { allowWorkspaceOpen: false /* open workspace file as file if dropped */ });
			dropHandler.handleDrop(e, () => this.group, () => this.group.focus(), targetIndex);
		}
	}

	private isMoveOperation(e: DragEvent, source: GroupIdentifier) {
		const isCopy = (e.ctrlKey && !isMacintosh) || (e.altKey && isMacintosh);

		return !isCopy || source === this.group.id;
	}

	dispose(): void {
		super.dispose();

		this.tabDisposables = dispose(this.tabDisposables);
	}
}

registerThemingParticipant((theme: ITheme, collector: ICssStyleCollector) => {
	// Add border between tabs and breadcrumbs in high contrast mode.
	if (theme.type === HIGH_CONTRAST) {
		const borderColor = (theme.getColor(TAB_BORDER) || theme.getColor(contrastBorder));
		collector.addRule(`
		.monaco-workbench div.tabs-and-actions-container {
			border-bottom: 1px solid ${borderColor};
		}
		`);
	}
	// Styling with Outline color (e.g. high contrast theme)
	const activeContrastBorderColor = theme.getColor(activeContrastBorder);
	if (activeContrastBorderColor) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active:hover  {
				outline: 1px solid;
				outline-offset: -5px;
			}

			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover  {
				outline: 1px dashed;
				outline-offset: -5px;
			}

			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active > .tab-close .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active:hover > .tab-close .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.dirty > .tab-close .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover > .tab-close .action-label {
				opacity: 1 !important;
			}
		`);
	}

	// High Contrast Border Color for Editor Actions
	const contrastBorderColor = theme.getColor(contrastBorder);
	if (contrastBorder) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .editor-actions {
				outline: 1px solid ${contrastBorderColor}
			}
		`);
	}

	// Hover Background
	const tabHoverBackground = theme.getColor(TAB_HOVER_BACKGROUND);
	if (tabHoverBackground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:hover  {
				background-color: ${tabHoverBackground} !important;
			}
		`);
	}

	const tabUnfocusedHoverBackground = theme.getColor(TAB_UNFOCUSED_HOVER_BACKGROUND);
	if (tabUnfocusedHoverBackground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover  {
				background-color: ${tabUnfocusedHoverBackground} !important;
			}
		`);
	}

	// Hover Border
	const tabHoverBorder = theme.getColor(TAB_HOVER_BORDER);
	if (tabHoverBorder) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:hover  {
				box-shadow: ${tabHoverBorder} 0 -1px inset !important;
			}
		`);
	}

	const tabUnfocusedHoverBorder = theme.getColor(TAB_UNFOCUSED_HOVER_BORDER);
	if (tabUnfocusedHoverBorder) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover  {
				box-shadow: ${tabUnfocusedHoverBorder} 0 -1px inset !important;
			}
		`);
	}

	// Fade out styles via linear gradient (when tabs are set to shrink)
	if (theme.type !== 'hc') {
		const workbenchBackground = WORKBENCH_BACKGROUND(theme);
		const editorBackgroundColor = theme.getColor(editorBackground);
		const editorGroupHeaderTabsBackground = theme.getColor(EDITOR_GROUP_HEADER_TABS_BACKGROUND);
		const editorDragAndDropBackground = theme.getColor(EDITOR_DRAG_AND_DROP_BACKGROUND);

		let adjustedTabBackground: Color | undefined;
		if (editorGroupHeaderTabsBackground && editorBackgroundColor) {
			adjustedTabBackground = editorGroupHeaderTabsBackground.flatten(editorBackgroundColor, editorBackgroundColor, workbenchBackground);
		}

		let adjustedTabDragBackground: Color | undefined;
		if (editorGroupHeaderTabsBackground && editorBackgroundColor && editorDragAndDropBackground && editorBackgroundColor) {
			adjustedTabDragBackground = editorGroupHeaderTabsBackground.flatten(editorBackgroundColor, editorDragAndDropBackground, editorBackgroundColor, workbenchBackground);
		}

		// Adjust gradient for focused and unfocused hover background
		const makeTabHoverBackgroundRule = (color: Color, colorDrag: Color, hasFocus = false) => `
				.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container${hasFocus ? '.active' : ''} > .title .tabs-container > .tab.sizing-shrink:not(.dragged):hover > .tab-label::after {
					background: linear-gradient(to left, ${color}, transparent) !important;
				}

				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container${hasFocus ? '.active' : ''} > .title .tabs-container > .tab.sizing-shrink:not(.dragged):hover > .tab-label::after {
					background: linear-gradient(to left, ${colorDrag}, transparent) !important;
				}
		`;

		// Adjust gradient for (focused) hover background
		if (tabHoverBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabHoverBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabHoverBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabHoverBackgroundRule(adjustedColor, adjustedColorDrag, true));
		}

		// Adjust gradient for unfocused hover background
		if (tabUnfocusedHoverBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabUnfocusedHoverBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabUnfocusedHoverBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabHoverBackgroundRule(adjustedColor, adjustedColorDrag));
		}

		// Adjust gradient for drag and drop background
		if (editorDragAndDropBackground && adjustedTabDragBackground) {
			const adjustedColorDrag = editorDragAndDropBackground.flatten(adjustedTabDragBackground);
			collector.addRule(`
			.monaco-workbench .part.editor > .content.dragged-over .editor-group-container.active > .title .tabs-container > .tab.sizing-shrink.dragged-over:not(.active):not(.dragged) > .tab-label::after,
			.monaco-workbench .part.editor > .content.dragged-over .editor-group-container:not(.active) > .title .tabs-container > .tab.sizing-shrink.dragged-over:not(.dragged) > .tab-label::after {
				background: linear-gradient(to left, ${adjustedColorDrag}, transparent) !important;
			}
		`);
		}

		// Adjust gradient for active tab background (focused and unfocused editor groups)
		const makeTabActiveBackgroundRule = (color: Color, colorDrag: Color, hasFocus = false) => `
				.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container${hasFocus ? '.active' : ':not(.active)'} > .title .tabs-container > .tab.sizing-shrink.active:not(.dragged) > .tab-label::after {
					background: linear-gradient(to left, ${color}, transparent);
				}

				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container${hasFocus ? '.active' : ':not(.active)'} > .title .tabs-container > .tab.sizing-shrink.active:not(.dragged) > .tab-label::after {
					background: linear-gradient(to left, ${colorDrag}, transparent);
				}
		`;

		// Adjust gradient for unfocused active tab background
		const tabActiveBackground = theme.getColor(TAB_ACTIVE_BACKGROUND);
		if (tabActiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabActiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabActiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabActiveBackgroundRule(adjustedColor, adjustedColorDrag, true));
		}

		// Adjust gradient for unfocused active tab background
		const tabUnfocusedActiveBackground = theme.getColor(TAB_UNFOCUSED_ACTIVE_BACKGROUND);
		if (tabUnfocusedActiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabUnfocusedActiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabUnfocusedActiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabActiveBackgroundRule(adjustedColor, adjustedColorDrag));
		}

		// Adjust gradient for inactive tab background
		const tabInactiveBackground = theme.getColor(TAB_INACTIVE_BACKGROUND);
		if (tabInactiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabInactiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabInactiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(`
			.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container > .title .tabs-container > .tab.sizing-shrink:not(.dragged) > .tab-label::after {
				background: linear-gradient(to left, ${adjustedColor}, transparent);
			}

			.monaco-workbench .part.editor > .content.dragged-over .editor-group-container > .title .tabs-container > .tab.sizing-shrink:not(.dragged) > .tab-label::after {
				background: linear-gradient(to left, ${adjustedColorDrag}, transparent);
			}
		`);
		}
	}
});
