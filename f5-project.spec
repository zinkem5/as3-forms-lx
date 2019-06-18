Summary: %{_ilx_name} %{_ilx_version}
Name: %{_ilx_name}
Version: %{_ilx_version}
Release: %{_release}
BuildArch: noarch
Group: Development/Tools
License: %{_ilx_license}
Packager: %{_ilx_author}

%description
%{_ilx_description}

%define IAPP_INSTALL_DIR /var/config/rest/iapps/%{name}

%prep
mkdir -p %{_builddir}
cp -r %{main}/src/* %{_builddir}
echo -n %{version}-%{release} > %{_builddir}/version


%install
rm -rf $RPM_BUILD_ROOT
mkdir -p $RPM_BUILD_ROOT%{IAPP_INSTALL_DIR}
cp -r %{_builddir}/* $RPM_BUILD_ROOT%{IAPP_INSTALL_DIR}

%clean rm -rf $RPM_BUILD_ROOT

%files
%defattr(-,root,root)
%{IAPP_INSTALL_DIR}
