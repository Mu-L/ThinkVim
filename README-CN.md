## ThinkVim 

<div align="center"><img style="width:300px;height:100px;box-shadow: 10px 10px 5px #888888;" src="https://github.com/Marlboro-go/Neovim-for-go/blob/master/screenshot/thinkvim.png"/></div>




## 特性


- 模块化
- 懒加载百分之80插件
- 完全自定义
- LSP语言服务支持

## 必要
* macos or linux
* neovim
* python3 support
* node and yarn
* NerdFont
### 必要工具

- ag (The Silver Searcher): [ggreer/the_silver_searcher](https://github.com/ggreer/the_silver_searcher)
- Universal ctags: [ctags.io](https://ctags.io/)
- Fuzzy file finders: [fzf](https://github.com/junegunn/fzf), [fzy](https://github.com/jhawthorn/fzy), or [peco](https://github.com/peco/peco)

## 安装
```
git clone https://github.com/taigacute/nvim-config.git ~/.config/nvim
```
**_1._** clone完成后打开你的终端或者GUI，输入nvim，会自动安装dein插件管理  
**_2._** 安装完成后，检测插件是否安装进行安装，由于国内clone较慢建议全局方式科学 
**_3._** 安装coc中间件，在normal模式输入`:CocInstall coc-neosnippet` `CocInstall coc-emmet`
**_4._** Enjoy hacking!

## 结构

- [rc/](~/.config/nvim/rc) - 配置文件目录
  - [dein](~/.config/nvim/rc/dein)  - _**插件安装!**_
    - [dein.toml](~/.config/nvim/rc/dein/dein.toml)     - 正常加载的插件
    - [deinlazy.toml](~/.config/nvim/rc/dein/deinlazy.toml) - 懒加载插件
  - [ftplugin](~/.config/nvim/rc/ftplugin) - 文件类型设置
  - [plugins](~/.config/nvim/rc/plugins) - _**插件设置!**_
  - [init.vim](~/.config/nvim/rc/init.vim) - `runtimepath` 初始化
  - [dein.vim](~/.config/nvim/rc/dein.vim) - Dein 配置
  - [general.vim](~/.config/nvim/rc/general.vim) - Vim基础设置
  - [mappings.vim](~/.config/nvim/rc/mappings.vim) - Vim功能键位绑定
  - [themes](./config/theme.vim) - 主题颜色
- [colors](~/.config/nvim/colors) - 主题文件



## 正常加载插件
Name           | Description
-------------- | ----------------------
[scrooloose/nerdcommenter] | 
[ctrlpvim/ctrlp.vim] |  
[tpope/vim-surround] |  
[tpope/vim-repeat] | 
[itchyny/lightline.vim] | 
[mengelbrecht/lightline-bufferline] | 
[taigacute/spaceline.vim] |
[vim-airline/vim-airline] |
[vim-airline/vim-airline-theme]|
[tpope/vim-fugitive] | 
[rking/ag.vim] | 
[sbdchd/neoformat] | 
[yonchu/accelerated-smooth-scroll] | 
[junegunn/fzf] | 
[junegunn/fzf.vim] | 
[ryanoasis/vim-devicons] | 
[mhinz/vim-startify] | 
[neoclide/coc.nvim] |

## 懒加载插件
Name           | Description
-------------- | ----------------------
[Yggdroot/indentLine] | 
[liuchengxu/vim-which-key] |
[easymotion/vim-easymotion] | 
[scrooloose/nerdtree] | 
[tiagofumo/vim-nerdtree-syntax-highlight] | 
[Shougo/defx.nvim] | 
[kristijanhusak/defx-icons] | 
[airblade/vim-gitgutter] | 
[majutsushi/tagbar] | 
[mattn/emmet-vim] | 
[Raimondi/delimitMate] | 
[Shougo/neosnippet.vim] | 
[Shougo/neosnippet-snippets] | 
[Shougo/denite.nvim] | 
[w0rp/ale] | 
[othree/html5.vim] | 
[pangloss/vim-javascript] | 
[maxmellon/vim-jsx-pretty] | 
[mxw/vim-jsx] | 
[hail2u/vim-css3-syntax] | 
[ap/vim-css-color] |
[fatih/vim-go] | 
[elzr/vim-json] | 
[cespare/vim-toml] |

## 选择你的喜好
* [Nerdtree](https://github.com/scrooloose/nerdtree) Or Defx(https://github.com/Shougo/defx.nvim)
  * 默认文件管理插件为defx，如果你想使用nerdtree，修改deinlazy.toml，取消nerdtree以及nerdtree-syntax-highlint，注释defx，或者同时使用.
* [Lightline](https://github.com/itchyny/lightline.vim) Or [Airline](https://github.com/vim-airline/vim-airline)
  * 默认的状态栏插件为lightline，如果你想使用airline，修改deinlazy.toml，取消airline以及vim-airline-theme并注释lightline。  
  _**NOTE!!Airline 需要更多的启动时间相比lightline**_  
  _**NOTE!!Defx 提供比nerdtree更加优秀的性能**_
## Option
关于键位的设置在mapping.vim，插件的键位设置在allkey.vim。根据你的习惯修改任意你喜欢的键位
## Language Support
语言工具支持，在coc.nvim主页查找你的开发语言server，并修改`coc-settings.json`添加你的语言服务器。
## 自定义
* 插件
   * 你可以添加任何你喜欢的插件,根据需求功能确定为正常加载或者懒加载，我更建议设置懒加载不会降低vim的启动速度也可以避免vim性能损耗卡顿，注意插件的键位设置应该在 `allkey.vim`.
* 颜色
   * 将你喜欢的 `colorscheme` 放到Colors文件夹中，然后修改 `themes/theme.vim`.如果你想修改补全框 `Pmenu` colors. 同样修改 Pmenu 的颜色在 `theme.vim` 
## Feedback
  * 如果你遇到了麻烦可以提issue或者 [Giiter](https://gitter.im/thinkvim/community)
