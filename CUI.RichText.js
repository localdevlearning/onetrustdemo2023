/* global Class: true */
/* jshint strict: false */
(function ($, CUI) {

  //'use strict';

  var idCounter = 1;

  CUI.RichText = new Class(/** @lends CUI.RichText# */ {

    toString: 'RichText',

    extend: CUI.Widget,

    editorKernel: null,

    useFixedInlineToolbar: false,

    uiSettings: null,

    $sourceEditor: undefined,

    savedSpellcheckAttrib: null,

    savedOutlineStyle: null,

    isActive: false,

    options: null,

    _initialContent: null,

    id: null,

    $valueOnFocus: null,

    /**
     * Flag to ignore the next "out of area" click event
     * @private
     * @type Boolean
     */
    ignoreNextClick: false,

    ignoreClick: false,

    construct: function (options) {
      this.options = options || {};
      if (this.options.componentType === 'table') {
        this.options['additionalClasses'] = {
          'table#exitTableEditing': 'rte--modechanger'
        };
      }
      if (this.options.hasOwnProperty('$ui')) {
        this.$element.data('rte-ui', this.options.$ui);
      }
      this.id = String(idCounter++);
    },

    getComponentType: function () {
      return this.options ? this.options.componentType : undefined;
    },

    // Helpers -------------------------------------------------------------------------

    _isMimeTypeAccepted: function(mimeType) {
      if (mimeType === undefined || mimeType === null ||
        (mimeType.indexOf('image/') !== 0 && mimeType.indexOf('application/pdf') !== 0)) {
        return false;
      }
      return true;
    },

    _dispatchEvent: function (name) {
      var isVetoed = false;
      if (this.options.listeners && this.options.listeners[name]) {
        var listenerFn = this.options.listeners[name];
        if (typeof listenerFn === 'function') {
          isVetoed = !!listenerFn.call(this);
        }
      }
      return isVetoed;
    },

    _hidePopover: function () {
      if (this.editorKernel.toolbar) {
        var tb = this.editorKernel.toolbar;
        if (tb.popover) {
          return tb.popover.hide();
        }
      }
      return false;
    },

    _finishRequested: function () {
      this.finish(true);
    },

    _saveRequested: function () {
      this.finish(false);
    },

    _onFocusGain: function() {
      if (this.$valueOnFocus === null || this.$valueOnFocus === undefined) {
        this.$valueOnFocus = this.$element.html();
      }
    },

    _onFocusLoss: function() {
      if (this.$element.html() !== this.$valueOnFocus) {
        this.$valueOnFocus = this.$element.html();
        this.$element.trigger('change');
      }
    },

    _handleToolbarOnSelectionChange: function () {
      var com = CUI.rte.Common;
      var editContext = this.editorKernel.getEditContext();
      var self = this;
      if (com.ua.isTouch) {
        // On touch devices (Safari Mobile), no touch events are dispatched while
        // the user defines a selection. As a workaround, we listen to
        // selectionchange events instead (which at least indicate changes in the
        // selection, but not when the selection process starts or ends). To
        // determine the end of the selection process, a timed "best guess" approach
        // is used - currently, the selection is declared "final" if it does not
        // change for a second. This works well even if the user changes the
        // selection after the 1sec interval - simply another cycle of
        // hiding/showing the toolbar gets started in that case.
        var _lastSel;
        this.$textContainer.on('selectionchange.rte-toolbarhide-' + this.id, function (e) {
          if (self.editorKernel.isLocked() || !self.isActive) {
            _lastSel = undefined;
            return;
          }
          var context = self.editorKernel.getEditContext();
          // using native selection instead of selection abstraction here, as
          // it is faster and we are in a controlled environment (Webkit mobile)
          // here
          var slct = context.win.getSelection();
          // check if selection is valid - if not, reuse last known selection or
          // set caret to the start of the text
          if (!com.isAncestor(context, context.root, slct.focusNode) || !com.isAncestor(context, context.root, slct.anchorNode)) {
            slct.removeAllRanges();
            var range = context.doc.createRange();
            if (_lastSel) {
              range.setStart(_lastSel.ande, _lastSel.aoffs);
              range.setEnd(_lastSel.fnde, _lastSel.foffs);
            } else {
              range.selectNodeContents(context.root);
              range.collapse(true);
            }
            slct.addRange(range);
          }
          if (!slct.isCollapsed) {
            var locks = context.getState('CUI.SelectionLock');
            if (locks === undefined) {
              var isSameSelection = false;
              if (_lastSel) {
                isSameSelection =
                  (_lastSel.ande === slct.anchorNode) &&
                  (_lastSel.aoffs === slct.anchorOffset) &&
                  (_lastSel.fnde === slct.focusNode) &&
                  (_lastSel.foffs === slct.focusOffset);
              }
              var tb = self.editorKernel.toolbar;
              if (!isSameSelection && !tb._isSticky) {
                tb.hideTemporarily();
              }
            } else {
              locks--;
              if (locks > 0) {
                context.setState('CUI.SelectionLock', locks);
              } else {
                context.setState('CUI.SelectionLock');
              }
            }
          }
          _lastSel = {
            ande: slct.anchorNode,
            aoffs: slct.anchorOffset,
            fnde: slct.focusNode,
            foffs: slct.focusOffset
          };
        });
      } else {
        var _isClick = false;
        var _isToolbarHidden = false;
        var body = editContext.doc.body;
        var $body = $(body);
        this.$textContainer.pointer('mousedown.rte-toolbarhide-' + this.id,
          function (e) {
            _isClick = true;
          });
        this.$textContainer.pointer('mousemove.rte-toolbarhide-' + this.id,
          function (e) {
            if (_isClick && !_isToolbarHidden && !self.editorKernel.isLocked()) {
              var tb = self.editorKernel.toolbar;
              if (!tb.isSticky() && !self.useFixedInlineToolbar) {
                self.editorKernel.toolbar.hide();
                _isToolbarHidden = true;
              }
            }
          });
        this.$textContainer.pointer('mouseup.rte-toolbarhide-' + this.id,
          function (e) {
            if (_isToolbarHidden) {
              self.editorKernel.toolbar.show();
              _isToolbarHidden = false;
            }
            _isClick = false;
          });
        $body.add(document.body).pointer('mouseup.rte-toolbarhide-' + this.id,
          function(e) {
              if (_isClick && _isToolbarHidden) {
                  self.editorKernel.toolbar.show();
                  _isToolbarHidden = false;
                  // Hide the popover just like textcontainer does when clicked
                  if (!self.editorKernel.isLocked()) {
                      self._hidePopover();
                  }
                  // Flag to cancel click event attached on the body
                  self.ignoreClick = true;
              }
              _isClick = false;
          });
      }
    },

    getTextDiv: function (parentEl) {
      return parentEl;
    },

    isEmptyText: function () {
      return false;
    },

    prepareForNewText: function () {
      /*
       CQ.form.rte.Common.removeAllChildren(this.textContainer);
       */
    },

    handleKeyUp: function (e) {
      // keyCode 27 refers to ESC key
      if (e.getCharCode() === 27) {
        if (!this.useFixedInlineToolbar && !this._dispatchEvent('beforeEscape')) {
          this.finish(true);
        }
      }
      if($(e.nativeEvent.target).attr('class') === this.$element.attr('class') && this.$element.hasClass('cq-RichText-editable') && this.$element.hasClass('coral-RichText-editable')){
        this.checkMountingToolbar(this);
      }
    },

    // For mounting/un-mounting RTE toolbar
    checkMountingToolbar: function(cntxt) {
      if (!cntxt.editorKernel.isLocked()) {
        cntxt._hidePopover();
      }
      if (cntxt.editorKernel.toolbar.isHidden()) {
        cntxt.editorKernel.toolbar.show();
      }
    },

    initializeEditorKernel: function (initialContent, isResumed) {
      var com = CUI.rte.Common;
      // Currently, the toolbar type is determined by analzing the full screen mode
      // definition. In later incarnations of the RTE it may make sense to make this
      // configurable explicitly
      var isFullScreen = !!this.options.isFullScreen;
      this.editorKernel.createToolbar({
        '$editable': this.$element,
        'uiSettings': this.uiSettings,
        'isFullScreen': isFullScreen,
        'tbType': (isFullScreen ? 'fullscreen' : 'inline'),
        'componentType': this.options.componentType,
        'additionalClasses': this.options.additionalClasses,
        'useFixedInlineToolbar': this.useFixedInlineToolbar
      });
      this.editorKernel.addUIListener('updatestate', this.updateState, this);
      this.editorKernel.addUIListener('focusgained', this._onFocusGain, this);
      this.editorKernel.addUIListener('focuslost', this._onFocusLoss, this);
      var doc = this.textContainer.ownerDocument;
      var win = com.getWindowForDocument(doc);
      this.editorKernel.initializeEditContext(win, doc, this.textContainer);
      this.editorKernel.initializeEventHandling();
      if (!isResumed) {
        if (this.options.hasOwnProperty('fullScreenAdapter')) {
          this.fullScreenAdapter = this.options.fullScreenAdapter;
        } else {
          this.fullScreenAdapter = new CUI.rte.ui.cui.DefaultFullScreenAdapter({
            'rteInstance': this
          });
        }
      }
      // since edit context is initialized again, we need to call setFullScreenAdapter again
      this.editorKernel.execCmd('setFullScreenAdapter', this.fullScreenAdapter);
      this.editorKernel.setUnprocessedHtml(initialContent || '');
      if (!isResumed && !this.options.preventCaretInitialize) {
        this.editorKernel.initializeCaret(true);
      }
      this.editorKernel.execCmd('initializeundo');
      this.editorKernel.addUIListener('requestClose', this._finishRequested, this);
      this.editorKernel.addUIListener('requestSave', this._saveRequested, this);
      var self = this;
      if (isFullScreen) {
        this.editorKernel.addUIListener('enablesourceedit', function () {
          self.fullScreenAdapter.toggleSourceEdit(true);
        }, this);
        this.editorKernel.addUIListener('disablesourceedit', function () {
          self.fullScreenAdapter.toggleSourceEdit(false);
        }, this);
      } else if (this.useFixedInlineToolbar) {
          this.editorKernel.addUIListener('enablesourceedit', function () {
            self.toggleSourceEdit(true);
          }, this);
          this.editorKernel.addUIListener('disablesourceedit', function () {
            self.toggleSourceEdit(false);
          }, this);
      }
      var tb = this.editorKernel.toolbar;
      if (CUI.rte.Common.ua.isTouch && !tb._isSticky) {
        // show the toolbar with a slight delay on touch devices; this looks a lot
        // smoother, as the device is most likely to scroll in the first
        // bunch of milliseconds anyway
        tb.hideTemporarily();
      }
    },

    initializeEventHandling: function () {
      var sel = CUI.rte.Selection;
      var self = this;
      var editContext = this.editorKernel.getEditContext();
      var body = editContext.doc.body;
      var $body = $(body);
      var $uiBody = $(document.body);
      // temporary focus handling - we need to retransfer focus immediately
      // to the text container (at least in iOS 6) to prevent the keyboard from
      // disappearing and losing the focus altogether
      $body.on('focus.rte-' + this.id, '.rte-toolbar-item', function (e) {
        var shouldHandleEvent = true;
        // catching exception for backward compatibility
        try {
          shouldHandleEvent = self.editorKernel.getToolbar().containsElement(e.currentTarget.parentElement);
        } catch (ex) {
          if (ex.message !== CUI.rte.Common.ERROR_MESSAGES.TOOLBAR.CONTAINS_ELEMENT_NOT_IMPLEMENTED) {
            throw ex;
          }
          shouldHandleEvent = true;
        }
        if (shouldHandleEvent) {
          // self.$textContainer.focus();
          e.stopPropagation();
          e.preventDefault();
        }
      });
      // Prevent changing the selection on touch devices when the editor is locked
      // (and the user is editing a dialog) - the "mask" implementation used on
      // desktop does not work as expected; SafariMobile does interesting things with
      // the mask switched on (for example, masks the dialog and allows editing
      // - despite the mask has a much higher z-index - instead of vice versa).
      this.$textContainer.finger('touchstart.rte-' + this.id, function (e) {
        if (self.editorKernel.isLocked()) {
          CUI.rte.UIUtils.killEvent(e);
        }
      });
      // additional keyboard handling (this is internal event handling - no ID
      // required/allowed! - "this" will be used for differentiation)
      CUI.rte.Eventing.on(editContext, body, 'keyup', this.handleKeyUp, this);
      // handle clicks/taps (clicks on the editable div vs. common/"out of area"
      // clicks vs. clicks on toolbar items)
      this.$textContainer.fipo('tap.rte-' + this.id, 'click.rte-' + this.id,
        function (e) {
          e.stopPropagation();
          self.checkMountingToolbar(self);
        });
      var bookmark;
      $body.add(document.body).fipo('touchstart.rte-ooa-' + this.id, 'mousedown.rte-ooa-' + this.id,
        function (e) {
          // we need to save the bookmark as soon as possible, as it gets lost
          // somewhere in the event handling between the initial
          // touchstart/mousedown event and the tap/click event where we
          // actually might need it
          var context = self.editorKernel.getEditContext();
          bookmark = sel.createRangeBookmark(context);
        });
      $body.add(document.body).fipo('tap.rte-ooa-' + this.id, 'click.rte-ooa-' + this.id, function (e) {
        // there are cases where "out of area clicks" must be ignored - for example,
        // on touch devices, the initial tap is followed by a click event that
        // would stop editing immediately; so the ignoreNextClick flag may be
        // used to handle those cases
        if (self.ignoreNextClick) {
          self.ignoreNextClick = false;
          return;
        }
        if (self.ignoreClick) {
          self.ignoreClick = false;
          return;
        }
        // also ignore if editing is currently locked
        if (self.editorKernel.isLocked()) {
          return;
        }
        // TODO find a cleaner solution ...
        if (self._hidePopover()) {
          var context = self.editorKernel.getEditContext();
          self.editorKernel.focus(context);
          // restore the bookmark that was saved on the initial
          // touchstart/mousedown event
          if (bookmark) {
            sel.selectRangeBookmark(context, bookmark);
            bookmark = undefined;
          }
          CUI.rte.UIUtils.killEvent(e);
        } else if (self.isActive && !self.useFixedInlineToolbar && !self.options.isFullScreen) {
          self.finish(false);
          self.$textContainer.blur();
        }
      });
      $body.finger('tap.rte-ooa-' + this.id, CUI.rte.UIUtils.killEvent);
      // prevent losing focus for toolbar items
      $uiBody.fipo('tap.rte-item-' + this.id, 'click.rte-item-' + this.id,
        '.rte-toolbar-item',
        function (e) {
          CUI.rte.UIUtils.killEvent(e);
        });
      $uiBody.on('click.rte-item-' + this.id,
        'coral-popover .rte-toolbar-list button',
        function (e) {
          CUI.rte.UIUtils.killEvent(e);
        });
      $uiBody.on('mousedown.rte-item-' + this.id, '.rte-toolbar-item',
        function (e) {
          CUI.rte.UIUtils.killEvent(e);
        });
      // prevent losing focus for popovers (additional elements)
      $uiBody.on('mousedown.rte-item-' + this.id,
        '.rte-toolbar-list button',
        function (e) {
          CUI.rte.UIUtils.killEvent(e);
        });
      // hide toolbar/popover while a selection is created
      this._handleToolbarOnSelectionChange();
    },

    deactivateEditorKernel: function () {
      if (this.editorKernel !== null && this.editorKernel !== undefined) {
        this.editorKernel.removeUIListener('requestClose');
        this.editorKernel.removeUIListener('requestSave');
        this.editorKernel.removeUIListener('updatestate');
        this.editorKernel.removeUIListener('focusgained');
        this.editorKernel.removeUIListener('focuslost');
        this.editorKernel.suspendEventHandling();
        this.editorKernel.destroyToolbar();
        this.editorKernel.destroyBackgroundToolbars();
        this.editorKernel.hasFocus = false;
      }
    },

    finalizeEventHandling: function () {
      if (this.editorKernel !== null && this.editorKernel !== undefined) {
        var context = this.editorKernel.getEditContext();
        var body = context.doc.body;
        var $body = $(body);
        var $uiBody = $(document.body);
        var $doc = $(context.doc);
        // Widget
        CUI.rte.Eventing.un(body, 'keyup', this.handleKeyUp, this);
        this.$textContainer.off('touchstart.rte-' + this.id +
          ' tap.rte-' + this.id + ' click.rte-' + this.id);
        $body.off('focus.rte-' + this.id + ' tap.rte-ooa-' + this.id +
          ' click.rte-ooa-' + this.id);
        $body.off('touchstart.rte-ooa-' + this.id +
          ' mousedown.rte-ooa-' + this.id + ' mouseup.rte-toolbarhide-' + this.id);
        // Toolbar
        $uiBody.off('tap.rte-item-' + this.id + ' click.rte-item-' + this.id);
        $uiBody.off('mousedown.rte-item-' + this.id + ' mouseup.rte-toolbarhide-' + this.id);
        this.$textContainer.off('mousemove.rte-toolbarhide-' + this.id);
        this.$textContainer.off('mouseup.rte-toolbarhide-' + this.id +
          ' mousedown.rte-toolbarhide-' + this.id);
        $doc.off('selectionchange.rte-toolbarhide-' + this.id);
      }
    },

    updateState: function () {
      this.editorKernel.updateToolbar();
    },


    // Interface -----------------------------------------------------------------------

    /**
     * Gets the current content of the edited text <i>while editing is in progress</i>.
     * Returns undefined before/after editing is started/has been finished.
     * @returns {String} The edited content; undefined if content is not being edited
     *          at the moment
     */
    getContent: function () {
      if (!this.isActive) {
        return undefined;
      }
      return this.editorKernel.getProcessedHtml();
    },

    setContent: function (html) {
      if (this.isActive) {
        this.editorKernel.setUnprocessedHtml(html);
      }
    },

    /**
     * Support for drag and drop of Image
     * @param event
     * @deprecated use notifyDrop method instead
     */
    insertImage: function(path) {
      var cmdValue = {
        path : path
      };
      this.editorKernel.relayCmd('insertimg', cmdValue);
    },

    /**
     * Handler that reacts on objects that were dropped on this editor.
     * @param {Object} dragData Description of the object that has been dropped on the
     *        component. This has to be of the form:
     *        {
     *          path: path of dropped object,
     *          mimeType: mime type of dropped object
     *        }
     *        if mimeType is empty string, dropped object is assumed to be a page.
     */
    notifyDrop: function(dragData) {
      var com = CUI.rte.Common;
      var sel = CUI.rte.Selection;
      var path = dragData.path;
      var mimeType = dragData.mimeType;
      if (path === undefined || path === null || !this._isMimeTypeAccepted(mimeType)) {
        return;
      }
      var isPage = (mimeType === '');
      var pSel = this.editorKernel.createQualifiedSelection(
        this.editorKernel.getEditContext());
      if (pSel && sel.isSelection(pSel)) {
        // insert as a link -> path has to be encoded before inserting the link;
        // see also bug #30206
        path = path.replace(/&/g, '%26');
        // todo respect link HTML rules
        // todo respect trim selection whitespace
        if (isPage) {
          path = path + '.html';
        }
        this.editorKernel.relayCmd('modifylink', {
          'url': path
        });
      } else {
        if (com.strStartsWith(mimeType, 'image/')) {
          // insert as image
          var cmdValue = {
            path: path
          };
          this.editorKernel.relayCmd('insertimg', cmdValue);
        }
      }
    },

    getUndoConfig: function () {
      return this.editorKernel.execCmd('getundoconfig');
    },

    setUndoConfig: function (undoConfig) {
      if (undoConfig) {
        this.editorKernel.execCmd('undoconfig', undoConfig);
      }
    },

    focus: function () {
      this.editorKernel.focus();
    },

    /**
     * Starts the editing of this richtext editor.
     * @param {Object} config initial configuration
     */
    startEditing: function(config) {
      if (this.isActive) {
        throw new Error('Cannot start an already active editor.');
      }
      this.originalConfig = (config ? CUI.rte.Utils.copyObject(config) : {});
      var isFullScreen = !!this.options.isFullScreen;
      this.useFixedInlineToolbar = (config ? config.useFixedInlineToolbar : undefined);
      this.uiSettings = (config ? config.uiSettings : undefined);
      if (this.editorKernel === null) {
        var ac = !!this.options.autoConfig;
        this.editorKernel = new CUI.rte.DivKernel(config,
          function (plugin, feature) {
            if (ac) {
              // ensure that fullscreen toggle + close button are always
              // available, even if not explicitly configured
              if (plugin === 'control') {
                return (feature === 'close' || feature === 'save');
              } else if (plugin === 'fullscreen') {
                var fsf = (isFullScreen ? undefined : 'start');
                return (feature === fsf);
              }
            }
            return undefined;
          });
      }
      var ua = CUI.rte.Common.ua;
      this.ignoreNextClick = ua.isTouch;
      this.$textContainer = this.getTextDiv(this.$element);
      this.$textContainer.addClass('is-edited');
      this.textContainer = this.$textContainer[0];
      if (!this.options.preventDOMRewrite) {
        this._initialContent = this.textContainer.innerHTML;
      }
      // if the component includes the "empty text placeholder", the placeholder
      // has to be removed and prepared for richtext editing
      this.isEmptyContent = this.isEmptyText();
      if (this.isEmptyContent) {
        this.prepareForNewText();
      }
      var initialContent = this.options.initialContent;
      if (initialContent === undefined) {
        initialContent = this.$textContainer.html();
      }
      this.textContainer.contentEditable = 'true';
      if (ua.isGecko || ua.isWebKit) {
        this.savedOutlineStyle = this.textContainer.style.outlineStyle;
        this.textContainer.style.outlineStyle = 'none';
      }
      this.initializeEditorKernel(initialContent);
      if (isFullScreen) {
        this.$sourceEditor = this.fullScreenAdapter.$sourceEditor;
      } else if (this.useFixedInlineToolbar) {
          this.$sourceEditor = $('<textarea/>');
          this.$sourceEditor.addClass('rte-sourceEditor');
          this.$sourceEditor.addClass('u-coral-noBorder');
          this.$textContainer.after(this.$sourceEditor);
          this.$sourceEditor.hide();
          this.$sourceEditor.fipo('tap.rte-' + this.id, 'click.rte-' + this.id,
            function (e) {
              e.stopPropagation();
            });
      }
      var context = this.editorKernel.getEditContext();
      var body = context.doc.body;
      this.savedSpellcheckAttrib = body.spellcheck;
      body.spellcheck = false;
      this.initializeEventHandling();
      this.isActive = true;
      this._dispatchEvent('onStarted');
      this.$element.trigger('editing-start');
    },

    /**
     * @deprecated use startEditing method instead and pass useFixedInlineToolbar as part of config
     */
    start: function (config, useFixedInlineToolbar) {
      config = $.extend(true, {}, config);
      config.useFixedInlineToolbar  = useFixedInlineToolbar ? useFixedInlineToolbar : config.useFixedInlineToolbar;
      this.startEditing(config);
    },

    finish: function (isCancelled) {
      if (this.sourceEditMode) {
        this.editorKernel.fireUIEvent('disablesourceedit');
      }
      if (this._dispatchEvent(isCancelled ? 'beforeCancel' : 'beforeFinish')) {
        return undefined;
      }
      var context = this.editorKernel.getEditContext();
      var body = context.doc.body;
      var editedContent = this.editorKernel.getProcessedHtml();
      if (this.isActive) {
        CUI.rte.Selection.resetSelection(context, 'start');
        this.finalizeEventHandling();
        this.deactivateEditorKernel();
        this.$textContainer.removeClass('is-edited');
        this.textContainer.contentEditable = 'inherit';
      }
      this.textContainer.blur();
      body.spellcheck = this.savedSpellcheckAttrib;
      var ua = CUI.rte.Common.ua;
      if ((ua.isGecko || ua.isWebKit) && this.savedOutlineStyle) {
        this.textContainer.style.outlineStyle = this.savedOutlineStyle;
      }
      if (!this.options.preventDOMRewrite) {
        this.textContainer.innerHTML =
          (isCancelled ? this._initialContent : editedContent);
      }
      this.isActive = false;
      this._dispatchEvent(isCancelled ? 'onCancelled' : 'onFinished');
      this.$element.trigger(isCancelled ? 'editing-cancelled' : 'editing-finished',
        [editedContent]);
      return editedContent;
    },

    suspend: function () {
      if (this.isActive) {
        this.editorKernel.getToolbar().hide();
        this.finalizeEventHandling();
        this.deactivateEditorKernel();
        this.$textContainer.removeClass('is-edited');
        this.textContainer.contentEditable = 'inherit';
        this.isActive = false;
      }
    },

    reactivate: function (initialContent) {
      if (!this.isActive) {
        this.$textContainer.addClass('is-edited');
        this.textContainer.contentEditable = 'true';
        this.initializeEditorKernel(initialContent, true);
        this.initializeEventHandling();
        this.editorKernel.getToolbar().show();
        this.isActive = true;
        this._dispatchEvent('onResumed');
      }
      },

    /**
     * Get content from source editor and push it into RTE.
     * @private
     */
    pushValue: function () {
      var v = this.$sourceEditor.val();
      if (!this.sourceEditMode || this.togglingSourceEdit) {
        this.editorKernel.setUnprocessedHtml(v);
      }
    },

    /**
     * Get content from RTE and push it into source editor.
     * @private
     */
    syncValue: function () {
      if (!this.sourceEditMode || this.togglingSourceEdit) {
        var html = this.editorKernel.getProcessedHtml();
        this.$sourceEditor.val(html);
      }
    },

    toggleSourceEdit: function (sourceEditMode) {
      this.togglingSourceEdit = true;
      if (sourceEditMode === undefined) {
        sourceEditMode = !this.sourceEditMode;
      }
      sourceEditMode = sourceEditMode === true;
      var isChanged = sourceEditMode !== this.sourceEditMode;
      this.sourceEditMode = sourceEditMode;
      var ek = this.editorKernel;
      if (!isChanged) {
        return;
      }
      if (this.sourceEditMode) {
        ek.disableFocusHandling();
        ek.notifyBlur();
        ek.disableToolbar(['sourceedit']);
        this.syncValue();
        this.$element.hide();
        this.$sourceEditor.show();
        this.$sourceEditor.focus();
        ek.firePluginEvent('sourceedit', {
          'enabled': true
        }, false);
      } else {
        ek.enableFocusHandling();
        if (this.initialized && !this.disabled) {
          ek.enableToolbar();
        }
        this.$element.show();
        this.$sourceEditor.hide();
        this.pushValue();
        ek.focus();
        ek.firePluginEvent('sourceedit', {
          'enabled': false
        }, false);
      }
      this.togglingSourceEdit = false;
    }

  });

  // Register ...
  CUI.util.plugClass(CUI.RichText, 'richEdit', function (rte) {
    CUI.rte.ConfigUtils.loadConfigAndStartEditing(rte, $(this));
  });

  // Data API
  if (CUI.options.dataAPI) {
    $(function () {
      // This listener will be executed only in those situations where we expect that
      // rte will be initialized on click inside contenteditable div, which is the case for stand-alone RTE
      // The selector is '.rte' and hence the contenteditable div needs to have this class if we want this
      // listener to work
      $('body').fipo('tap.rte.data-api', 'click.rte.data-api', '.rte',
        function (e) {
          var $this = $(this);
          if (!$this.hasClass('is-edited') && !$this.hasClass('is-initializing')) {
            $this.richEdit();
            e.preventDefault();
          }
        });
    });
  }

}(window.jQuery, window.CUI));
